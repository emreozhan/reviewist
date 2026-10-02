/**
 * Etki grafiği: değişen tipler + değişen üyeler + diff dışında etkilenenler (çağıranlar, override edenler, alt tipler;
 * status 'impacted'). Kenarlar: calls / overrides / extends / implements / contains / tests. Kenar id'leri kararlı:
 * `${kind}:${from}->${to}`. Düğüm sınırı aşılırsa riske göre kırpılır.
 */
import type { CallRef, FileChange, ImpactEdge, ImpactGraph, ImpactNode, Layer, RiskLevel, TypeKind } from '../../shared/types.js';
import type { RepoIndexApi, TypeDiff } from '../java/model.js';
import { isSemanticChange } from './risk.js';
import { maxLevel, RISK_LEVEL_ORDER, simpleTypeName, symbolLabel } from './util.js';

export const MAX_GRAPH_NODES = 600;

export interface GraphInput {
  typeDiffs: readonly TypeDiff[];
  files: readonly FileChange[];
  index: Pick<RepoIndexApi, 'getMember' | 'getType' | 'getFileOfType'>;
  staleCalls?: ReadonlyMap<string, readonly CallRef[]>;
  /** Diff dışı düğümün katmanı. */
  layerOf: (path: string | undefined, typeFqn: string | undefined) => Layer;
  maxNodes?: number;
}

export interface GraphResult {
  graph: ImpactGraph;
  /** Diff dışında etkilenen farklı sembol sayısı (kırpmadan önce). */
  impactedOutsideDiff: number;
  truncatedFrom?: number;
}

export function buildGraph(input: GraphInput): GraphResult {
  const nodes = new Map<string, ImpactNode>();
  const score = new Map<string, number>();
  const edges = new Map<string, ImpactEdge>();
  const impactedBy = new Map<string, Set<string>>();
  const tdById = new Map<string, TypeDiff>();
  for (const td of input.typeDiffs) if (!tdById.has(td.change.id) || td.newType) tdById.set(td.change.id, td);

  const addEdge = (kind: ImpactEdge['kind'], from: string, to: string) => {
    if (from === to) return;
    const id = `${kind}:${from}->${to}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, kind });
  };

  // Değişen tipler ve üyeler
  for (const td of tdById.values()) {
    const ch = td.change;
    const semMembers = td.members.filter((m) => isSemanticChange(m.change.status));
    if (!isSemanticChange(ch.status) && semMembers.length === 0) continue;
    nodes.set(ch.id, {
      id: ch.id,
      label: ch.name,
      kind: ch.kind,
      status: isSemanticChange(ch.status) ? ch.status : 'modified',
      file: ch.file,
      typeId: ch.id,
      layer: ch.layer,
      riskLevel: ch.risk.level,
    });
    score.set(ch.id, ch.risk.score + 0.5);
    for (const md of semMembers) {
      const mc = md.change;
      if (nodes.has(mc.id)) continue;
      nodes.set(mc.id, { id: mc.id, label: symbolLabel(mc.id), kind: mc.kind, status: mc.status, file: ch.file, typeId: ch.id, layer: ch.layer, riskLevel: mc.risk.level });
      score.set(mc.id, mc.risk.score);
      addEdge('contains', ch.id, mc.id);
    }
  }
  const changed = new Set(nodes.keys());

  const impact = (id: string, source: string, fallback: { file?: string; kind?: TypeKind | 'method' }) => {
    if (changed.has(id)) return;
    let set = impactedBy.get(id);
    if (!set) {
      set = new Set();
      impactedBy.set(id, set);
      const isMember = id.includes('#');
      if (isMember) {
        const r = input.index.getMember(id);
        nodes.set(id, {
          id,
          label: symbolLabel(id),
          kind: r?.member.kind ?? 'method',
          status: 'impacted',
          file: r?.file.path ?? fallback.file,
          typeId: r?.type.fqn ?? id.slice(0, id.indexOf('#')),
          layer: input.layerOf(r?.file.path ?? fallback.file, r?.type.fqn),
          riskLevel: 'low',
        });
      } else {
        const t = input.index.getType(id);
        const f = input.index.getFileOfType(id);
        nodes.set(id, {
          id,
          label: t?.name ?? simpleTypeName(id),
          kind: t?.kind ?? (fallback.kind as TypeKind | undefined) ?? 'class',
          status: 'impacted',
          file: f?.path ?? fallback.file,
          typeId: id,
          layer: input.layerOf(f?.path ?? fallback.file, id),
          riskLevel: 'low',
        });
      }
    }
    set.add(source);
  };

  for (const td of tdById.values()) {
    const ch = td.change;
    if (!changed.has(ch.id)) continue;
    // Kalıtım
    for (const sub of ch.subTypes) {
      impact(sub, ch.id, {});
      addEdge(inheritanceKind(sub, ch.id, tdById, input), sub, ch.id);
    }
    for (const sup of ch.superTypes) {
      if (changed.has(sup)) addEdge(inheritanceKind(ch.id, sup, tdById, input), ch.id, sup);
    }
    for (const md of td.members) {
      const mc = md.change;
      if (!changed.has(mc.id) || nodes.get(mc.id)?.typeId !== ch.id) continue;
      for (const c of mc.callers) {
        impact(c.fromId, mc.id, { file: c.file });
        addEdge('calls', c.fromId, mc.id);
      }
      for (const c of input.staleCalls?.get(mc.id) ?? []) {
        impact(c.fromId, mc.id, { file: c.file });
        addEdge('calls', c.fromId, mc.id);
      }
      for (const callee of mc.callees) if (changed.has(callee)) addEdge('calls', mc.id, callee);
      for (const o of mc.overriddenBy) {
        impact(o, mc.id, {});
        addEdge('overrides', o, mc.id);
      }
      for (const o of mc.overrides) if (changed.has(o)) addEdge('overrides', mc.id, o);
    }
  }

  // Test kenarları: test dosyasındaki değişen tip → üretim dosyasının tipleri
  const typesByFile = new Map<string, string[]>();
  for (const n of nodes.values()) {
    if (!changed.has(n.id) || n.id.includes('#') || !n.file) continue;
    const list = typesByFile.get(n.file);
    if (list) list.push(n.id);
    else typesByFile.set(n.file, [n.id]);
  }
  for (const f of input.files) {
    if (f.isTest) continue;
    const prodTypes = (typesByFile.get(f.path) ?? []).filter((id) => !tdById.get(id)?.newType?.outerFqn);
    if (!prodTypes.length) continue;
    for (const t of f.relatedTestFiles) for (const testType of typesByFile.get(t) ?? []) for (const p of prodTypes) addEdge('tests', testType, p);
  }

  // Etkilenen düğümlerin risk seviyesi: etkilendiği değişen sembollerin en yükseği
  for (const [id, sources] of impactedBy) {
    const n = nodes.get(id);
    if (!n) continue;
    const levels: RiskLevel[] = [...sources].map((s) => nodes.get(s)?.riskLevel ?? 'low');
    n.riskLevel = maxLevel(levels);
    score.set(id, Math.max(...[...sources].map((s) => score.get(s) ?? 0)) - 0.25);
  }

  const impactedOutsideDiff = impactedBy.size;
  const max = input.maxNodes ?? MAX_GRAPH_NODES;
  let keptNodes = [...nodes.values()];
  let truncatedFrom: number | undefined;
  if (keptNodes.length > max) {
    truncatedFrom = keptNodes.length;
    keptNodes = keptNodes
      .sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || RISK_LEVEL_ORDER[b.riskLevel] - RISK_LEVEL_ORDER[a.riskLevel] || a.id.localeCompare(b.id))
      .slice(0, max);
  }
  const keep = new Set(keptNodes.map((n) => n.id));
  keptNodes.sort((a, b) => a.id.localeCompare(b.id));
  const keptEdges = [...edges.values()].filter((e) => keep.has(e.from) && keep.has(e.to)).sort((a, b) => a.id.localeCompare(b.id));
  return { graph: { nodes: keptNodes, edges: keptEdges }, impactedOutsideDiff, truncatedFrom };
}

function inheritanceKind(sub: string, sup: string, tdById: Map<string, TypeDiff>, input: GraphInput): 'extends' | 'implements' {
  const supKind = tdById.get(sup)?.change.kind ?? input.index.getType(sup)?.kind;
  const subKind = tdById.get(sub)?.change.kind ?? input.index.getType(sub)?.kind;
  return supKind === 'interface' && subKind !== 'interface' ? 'implements' : 'extends';
}

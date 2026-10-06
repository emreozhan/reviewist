/**
 * Etki grafiği: değişen tipler + değişen üyeler + diff dışında etkilenenler (çağıranlar, override edenler, alt tipler;
 * status 'impacted'). Kenarlar: calls / overrides / extends / implements / contains / tests. Kenar id'leri kararlı:
 * `${kind}:${from}->${to}`. Düğüm sınırı aşılırsa riske göre kırpılır. Her düğüm bildirim aralığını (range/rangeSide) taşır:
 * değişenlerde head (silinmişse eski) aralığı, diff dışı etkilenenlerde RepoIndex'teki (head) aralık.
 */
import type { CallRef, FileChange, ImpactEdge, ImpactGraph, ImpactNode, Layer, Range, RiskLevel, TypeKind } from '../../shared/types.js';
import type { RepoIndexApi, TypeDiff } from '../java/model.js';
import { isSemanticChange } from './risk.js';
import { maxLevel, RISK_LEVEL_ORDER, simpleTypeName, symbolLabel } from './util.js';
import { compareStrings } from '../compare.js';

export const MAX_GRAPH_NODES = 600;

export interface GraphInput {
  typeDiffs: readonly TypeDiff[];
  files: readonly FileChange[];
  index: Pick<RepoIndexApi, 'getMember' | 'getType' | 'getFileOfType'>;
  staleCalls?: ReadonlyMap<string, readonly CallRef[]>;
  /** Diff dışı düğümün katmanı. */
  layerOf: (path: string | undefined, typeFqn: string | undefined) => Layer;
  maxNodes?: number;
  /** Model id → indeks id (çift FQN '@kök' soneki). Verilmezse aynen. */
  toIndexId?: (id: string) => string;
}

export interface GraphResult {
  graph: ImpactGraph;
  /** Diff dışında etkilenen farklı sembol sayısı (kırpmadan önce). */
  impactedOutsideDiff: number;
  truncatedFrom?: number;
}

export function buildGraph(input: GraphInput): GraphResult {
  const toIdx = input.toIndexId ?? ((id: string) => id);
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
      ...rangeOf(ch.newRange, ch.oldRange),
    });
    score.set(ch.id, ch.risk.score + 0.5);
    for (const md of semMembers) {
      const mc = md.change;
      if (nodes.has(mc.id)) continue;
      nodes.set(mc.id, {
        id: mc.id,
        label: symbolLabel(mc.id),
        kind: mc.kind,
        status: mc.status,
        file: ch.file,
        typeId: ch.id,
        layer: ch.layer,
        riskLevel: mc.risk.level,
        ...rangeOf(mc.newRange, mc.oldRange),
      });
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
        const r = input.index.getMember(toIdx(id));
        nodes.set(id, {
          id,
          label: symbolLabel(id),
          kind: r?.member.kind ?? 'method',
          status: 'impacted',
          file: r?.file.path ?? fallback.file,
          typeId: r?.type.fqn ?? id.slice(0, id.indexOf('#')),
          layer: input.layerOf(r?.file.path ?? fallback.file, r?.type.fqn),
          riskLevel: 'low',
          ...rangeOf(r?.member.range, undefined),
        });
      } else {
        const t = input.index.getType(toIdx(id));
        const f = input.index.getFileOfType(toIdx(id));
        nodes.set(id, {
          id,
          label: t?.name ?? simpleTypeName(id),
          kind: t?.kind ?? (fallback.kind as TypeKind | undefined) ?? 'class',
          status: 'impacted',
          file: f?.path ?? fallback.file,
          typeId: id,
          layer: input.layerOf(f?.path ?? fallback.file, toIdx(id)),
          riskLevel: 'low',
          ...rangeOf(t?.range, undefined),
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

  // Etkilenen düğümlerin risk seviyesi: etkilendiği değişen sembollerin en yükseği; test katmanındaysa bir kademe düşük
  // (diff dışı bir testin kırılması üretim kodunun kırılmasından daha az zararlıdır).
  for (const [id, sources] of impactedBy) {
    const n = nodes.get(id);
    if (!n) continue;
    const levels: RiskLevel[] = [...sources].map((s) => nodes.get(s)?.riskLevel ?? 'low');
    n.riskLevel = maxLevel(levels);
    if (n.layer === 'test') n.riskLevel = lowerLevel(n.riskLevel);
    score.set(id, Math.max(...[...sources].map((s) => score.get(s) ?? 0)) - 0.25);
  }

  const impactedOutsideDiff = impactedBy.size;
  const max = input.maxNodes ?? MAX_GRAPH_NODES;
  let keptNodes = [...nodes.values()];
  let truncatedFrom: number | undefined;
  if (keptNodes.length > max) {
    truncatedFrom = keptNodes.length;
    keptNodes = keptNodes
      .sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || RISK_LEVEL_ORDER[b.riskLevel] - RISK_LEVEL_ORDER[a.riskLevel] || compareStrings(a.id, b.id))
      .slice(0, max);
  }
  const keep = new Set(keptNodes.map((n) => n.id));
  keptNodes.sort((a, b) => compareStrings(a.id, b.id));
  const keptEdges = [...edges.values()].filter((e) => keep.has(e.from) && keep.has(e.to)).sort((a, b) => compareStrings(a.id, b.id));
  return { graph: { nodes: keptNodes, edges: keptEdges }, impactedOutsideDiff, truncatedFrom };
}

const LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];

function lowerLevel(level: RiskLevel): RiskLevel {
  return LEVELS[Math.max(0, RISK_LEVEL_ORDER[level] - 1)];
}

/** Düğüm aralığı: head tarafı varsa o, yoksa (silinmiş) eski taraf. */
function rangeOf(newRange: Range | undefined, oldRange: Range | undefined): Pick<ImpactNode, 'range' | 'rangeSide'> {
  if (newRange) return { range: { startLine: newRange.startLine, endLine: newRange.endLine }, rangeSide: 'new' };
  if (oldRange) return { range: { startLine: oldRange.startLine, endLine: oldRange.endLine }, rangeSide: 'old' };
  return {};
}

function inheritanceKind(sub: string, sup: string, tdById: Map<string, TypeDiff>, input: GraphInput): 'extends' | 'implements' {
  const toIdx = input.toIndexId ?? ((id: string) => id);
  const supKind = tdById.get(sup)?.change.kind ?? input.index.getType(toIdx(sup))?.kind;
  const subKind = tdById.get(sub)?.change.kind ?? input.index.getType(toIdx(sub))?.kind;
  return supKind === 'interface' && subKind !== 'interface' ? 'implements' : 'extends';
}

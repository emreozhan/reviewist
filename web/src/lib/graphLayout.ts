import dagre from '@dagrejs/dagre';
import type { ChangeGroup, ImpactEdge, ImpactGraph, ReviewModel } from '../../../src/shared/types';
import { isHighRisk, RISK_RANK } from './selectors';

export interface GraphFilter {
  /** Seçili ChangeGroup; null ise grup filtresi yok. */
  groupId: string | null;
  onlyHighRisk: boolean;
  /** Seed düğümlere kaç adım komşu eklenecek. */
  hops: number;
  /** 'contains' kenarlarını (tip → üye) gizle. */
  hideContains: boolean;
}

/** Bu düğüm sayısının üstünde varsayılan olarak filtreli açılır. */
export const LARGE_GRAPH = 120;

/** Gösterilen düğüm bu sayıyı aşarsa kullanıcı uyarılır. */
export const HEAVY_GRAPH = 300;

/**
 * Varsayılan filtre: odaklı ve okunur bir başlangıç. Seçili sembolün grubu, yoksa en riskli grup;
 * grup yoksa küçük graflarda tümü, büyüklerde yalnız yüksek risk.
 */
export function defaultGraphFilter(review: ReviewModel, selectedSymbolId?: string | null): GraphFilter {
  const base: GraphFilter = { groupId: null, onlyHighRisk: false, hops: 1, hideContains: true };
  const own = selectedSymbolId ? review.groups.find((g) => g.symbolIds.includes(selectedSymbolId)) : undefined;
  if (own) return { ...base, groupId: own.id };
  const top = [...review.groups].sort((a, b) => RISK_RANK[b.riskLevel] - RISK_RANK[a.riskLevel] || b.symbolIds.length - a.symbolIds.length)[0];
  if (top) return { ...base, groupId: top.id };
  return review.graph.nodes.length > LARGE_GRAPH ? { ...base, onlyHighRisk: true } : base;
}

/** Grup/risk filtresine göre seed düğümleri seçip `hops` komşulukla genişletir. */
export function selectSubgraph(graph: ImpactGraph, groups: readonly ChangeGroup[], filter: GraphFilter): ImpactGraph {
  const edges = filter.hideContains ? graph.edges.filter((e) => e.kind !== 'contains') : graph.edges;
  const group = filter.groupId ? groups.find((g) => g.id === filter.groupId) : undefined;
  let seeds: Set<string>;
  if (group) {
    const fileSet = new Set(group.fileIds);
    const symSet = new Set(group.symbolIds);
    seeds = new Set(graph.nodes.filter((n) => symSet.has(n.id) || (n.file !== undefined && fileSet.has(n.file) && n.status !== 'unchanged')).map((n) => n.id));
  } else {
    seeds = new Set(graph.nodes.map((n) => n.id));
  }
  if (filter.onlyHighRisk) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    seeds = new Set([...seeds].filter((id) => {
      const n = byId.get(id);
      return !!n && isHighRisk(n.riskLevel);
    }));
  }
  const keep = new Set(seeds);
  if (group || filter.onlyHighRisk) {
    let frontier = new Set(seeds);
    for (let h = 0; h < filter.hops; h++) {
      const next = new Set<string>();
      for (const e of edges) {
        if (frontier.has(e.from) && !keep.has(e.to)) next.add(e.to);
        if (frontier.has(e.to) && !keep.has(e.from)) next.add(e.from);
      }
      for (const id of next) keep.add(id);
      frontier = next;
    }
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

export interface LayoutInputNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutInput {
  nodes: LayoutInputNode[];
  edges: Pick<ImpactEdge, 'from' | 'to' | 'kind'>[];
}

export const NODE_HEIGHT = 50;

export function nodeWidth(label: string): number {
  return Math.max(140, Math.min(340, Math.round(label.length * 8 + 52)));
}

/** Dagre girdisi: düğüm boyutları etiket uzunluğundan; kalıtım kenarları ters çevrilir (üst tip solda). */
export function layoutInput(graph: ImpactGraph): LayoutInput {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, width: nodeWidth(n.label), height: NODE_HEIGHT })),
    edges: graph.edges.map((e) => {
      const upward = e.kind === 'extends' || e.kind === 'implements' || e.kind === 'overrides';
      return upward ? { from: e.to, to: e.from, kind: e.kind } : { from: e.from, to: e.to, kind: e.kind };
    }),
  };
}

export interface Positioned {
  x: number;
  y: number;
}

export function computeLayout(input: LayoutInput, rankdir: 'LR' | 'TB' = 'LR'): Map<string, Positioned> {
  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({ rankdir, nodesep: 18, ranksep: 70, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of input.nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of input.edges) {
    if (e.from === e.to || !g.hasNode(e.from) || !g.hasNode(e.to)) continue;
    g.setEdge(e.from, e.to, { weight: e.kind === 'contains' ? 2 : 1 });
  }
  dagre.layout(g);
  const out = new Map<string, Positioned>();
  for (const n of input.nodes) {
    const p = g.node(n.id) as { x?: number; y?: number } | undefined;
    // dagre merkez koordinat verir; React Flow sol üst köşe bekler.
    out.set(n.id, { x: (p?.x ?? 0) - n.width / 2, y: (p?.y ?? 0) - n.height / 2 });
  }
  return out;
}

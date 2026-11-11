import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { ImpactEdge, ImpactGraph, ImpactNode } from '../../../../src/shared/types';
import type { Positioned } from '../../lib/graphLayout';
import { computeLayout, layoutInput, nodeWidth, NODE_HEIGHT } from '../../lib/graphLayout';

export interface ImpactNodeData extends Record<string, unknown> {
  node: ImpactNode;
  dim: boolean;
  selected: boolean;
}

export type ImpactFlowNode = Node<ImpactNodeData, 'impact'>;

const UPWARD = new Set<ImpactEdge['kind']>(['extends', 'implements', 'overrides']);

/** Pahalı kısım: dagre yerleşimi (yalnız alt graf değişince). */
export function layoutGraph(graph: ImpactGraph): Map<string, Positioned> {
  return computeLayout(layoutInput(graph));
}

/** Ucuz kısım: seçime göre soluklaştırılmış React Flow düğüm/kenarları. */
export function toFlow(graph: ImpactGraph, pos: Map<string, Positioned>, selectedId: string | null): { nodes: ImpactFlowNode[]; edges: Edge[] } {
  const neighbors = new Set<string>();
  if (selectedId) {
    neighbors.add(selectedId);
    for (const e of graph.edges) {
      if (e.from === selectedId) neighbors.add(e.to);
      if (e.to === selectedId) neighbors.add(e.from);
    }
  }
  const nodes: ImpactFlowNode[] = graph.nodes.map((n) => ({
    id: n.id,
    type: 'impact',
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    width: nodeWidth(n.label),
    height: NODE_HEIGHT,
    data: { node: n, dim: !!selectedId && !neighbors.has(n.id), selected: n.id === selectedId },
  }));
  const edges: Edge[] = graph.edges.map((e) => {
    const upward = UPWARD.has(e.kind);
    const touches = !selectedId || e.from === selectedId || e.to === selectedId;
    const marker = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: `var(--edge-${e.kind})` };
    return {
      id: e.id,
      source: upward ? e.to : e.from,
      target: upward ? e.from : e.to,
      className: `iedge iedge--${e.kind}${touches ? '' : ' is-dim'}`,
      markerEnd: upward ? undefined : marker,
      markerStart: upward ? marker : undefined,
    };
  });
  return { nodes, edges };
}

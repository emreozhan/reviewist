import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import type { NodeMouseHandler } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { defaultGraphFilter, selectSubgraph } from '../../lib/graphLayout';
import { useTheme } from '../../state/theme';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { AutoFit, FIT_OPTIONS } from './AutoFit';
import { GraphLegend } from './GraphLegend';
import { GraphNode } from './GraphNode';
import { GraphNodeCard } from './GraphNodeCard';
import { GraphToolbar } from './GraphToolbar';
import type { ImpactFlowNode } from './graphElements';
import { layoutGraph, toFlow } from './graphElements';

const NODE_TYPES = { impact: GraphNode };

/** Etki haritası: dagre ile soldan sağa yerleşim; büyük graflarda varsayılan olarak filtreli açılır. */
export function ImpactMap() {
  const { review } = useReviewCtx();
  const stored = useUi((s) => s.graphFilter);
  const setStored = useUi((s) => s.setGraphFilter);
  const selectedSymbol = useUi((s) => s.selectedSymbolId);
  const filter = useMemo(() => stored ?? defaultGraphFilter(review, selectedSymbol), [stored, review, selectedSymbol]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const themePref = useTheme((s) => s.pref);

  const sub = useMemo(() => selectSubgraph(review.graph, review.groups, filter), [review, filter]);
  const positions = useMemo(() => layoutGraph(sub), [sub]);
  const flow = useMemo(() => toFlow(sub, positions, selectedId), [sub, positions, selectedId]);
  const selectedNode = selectedId ? sub.nodes.find((n) => n.id === selectedId) : undefined;
  const big = sub.nodes.length > 150;
  // Filtre ya da düğüm kümesi değişince yeniden sığdır (seçim değişimi sığdırmayı tetiklemez).
  const fitSignature = useMemo(() => `${JSON.stringify(filter)}|${sub.nodes.length}|${sub.edges.length}`, [filter, sub]);

  const onNodeClick: NodeMouseHandler<ImpactFlowNode> = (_e, node) => setSelectedId((cur) => (cur === node.id ? null : node.id));

  return (
    <div className="gmap">
      <GraphToolbar filter={filter} onChange={(f) => { setStored(f); setSelectedId(null); }} shown={{ nodes: sub.nodes.length, edges: sub.edges.length }} />
      <div className="gmap__canvas">
        {sub.nodes.length === 0 ? (
          <p className="gmap__empty">Bu filtreyle gösterilecek düğüm yok.</p>
        ) : (
          <ReactFlow<ImpactFlowNode>
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onlyRenderVisibleElements={big}
            fitView
            fitViewOptions={FIT_OPTIONS}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            colorMode={themePref}
          >
            <AutoFit signature={fitSignature} />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap<ImpactFlowNode> pannable zoomable className="gmap__mini" nodeClassName={(n) => `mini-${n.data.node.status}`} />
          </ReactFlow>
        )}
        <GraphLegend />
        {selectedNode && <GraphNodeCard key={selectedNode.id} node={selectedNode} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

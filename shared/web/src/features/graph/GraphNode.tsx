import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { KIND_LABEL, RISK_LABEL, STATUS_META } from '../../lib/labels';
import { LAYER_LABEL } from '../../lib/selectors';
import type { ImpactFlowNode } from './graphElements';

/** Etki haritası düğümü: durum rengi + glif; 'impacted' kesikli kenarlı. */
export function GraphNode({ data }: NodeProps<ImpactFlowNode>) {
  const n = data.node;
  const meta = STATUS_META[n.status];
  return (
    <div
      className={`gnode status--${n.status} risk-node--${n.riskLevel}${data.dim ? ' is-dim' : ''}${data.selected ? ' is-selected' : ''}`}
      title={`${n.label} — ${meta.label} · ${KIND_LABEL[n.kind]} · risk ${RISK_LABEL[n.riskLevel]}`}
    >
      <Handle type="target" position={Position.Left} className="gnode__handle" isConnectable={false} />
      <span className="gnode__glyph" aria-hidden="true">{meta.glyph}</span>
      <span className="gnode__body">
        <span className="gnode__label">{n.label}</span>
        <span className="gnode__meta">
          {KIND_LABEL[n.kind]} · {LAYER_LABEL[n.layer]}
        </span>
      </span>
      <span className={`gnode__risk risk-fill--${n.riskLevel}`} aria-hidden="true" />
      <Handle type="source" position={Position.Right} className="gnode__handle" isConnectable={false} />
    </div>
  );
}

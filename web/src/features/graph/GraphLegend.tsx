import type { ImpactEdge, ImpactNodeStatus } from '../../../../src/shared/types';
import { EDGE_LABEL, STATUS_META } from '../../lib/labels';

const STATUSES: ImpactNodeStatus[] = ['signatureChanged', 'modified', 'added', 'removed', 'renamed', 'moved', 'cosmetic', 'impacted', 'unchanged'];
const EDGES: ImpactEdge['kind'][] = ['calls', 'overrides', 'extends', 'implements', 'contains', 'tests'];

export function GraphLegend() {
  return (
    <details className="glegend" open>
      <summary className="glegend__summary">Lejant</summary>
      <p className="glegend__title">Düğüm</p>
      <ul className="glegend__list">
        {STATUSES.map((s) => (
          <li key={s}>
            <span className={`glegend__node status--${s}`} aria-hidden="true">{STATUS_META[s].glyph}</span>
            {STATUS_META[s].label}
          </li>
        ))}
      </ul>
      <p className="glegend__title">Kenar</p>
      <ul className="glegend__list">
        {EDGES.map((k) => (
          <li key={k}>
            <svg className="glegend__edge" width="34" height="10" aria-hidden="true">
              <line x1="2" y1="5" x2="30" y2="5" className={`glegend__line iedge--${k}`} />
            </svg>
            {EDGE_LABEL[k]}
          </li>
        ))}
      </ul>
      <p className="glegend__hint">Kalıtım okları üst tipe doğru; sağdaki çubuk risk düzeyi.</p>
    </details>
  );
}

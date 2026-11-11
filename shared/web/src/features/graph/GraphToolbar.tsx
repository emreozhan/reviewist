import { useId } from 'react';
import { Segmented } from '../../components/Segmented';
import { Switch } from '../../components/Switch';
import type { GraphFilter } from '../../lib/graphLayout';
import { HEAVY_GRAPH } from '../../lib/graphLayout';
import { RISK_LABEL } from '../../lib/labels';
import { useReviewCtx } from '../workspace/ReviewContext';

interface GraphToolbarProps {
  filter: GraphFilter;
  onChange: (f: GraphFilter) => void;
  shown: { nodes: number; edges: number };
}

export function GraphToolbar({ filter, onChange, shown }: GraphToolbarProps) {
  const { review, index } = useReviewCtx();
  const selectId = useId();
  const groups = index.groupsByRisk;
  const total = review.graph.nodes.length;
  const heavy = shown.nodes > HEAVY_GRAPH;

  return (
    <div className="gbar">
      <div className="gbar__field">
        <label htmlFor={selectId} className="gbar__label">
          Grup
        </label>
        <select id={selectId} className="input gbar__select" value={filter.groupId ?? ''} onChange={(e) => onChange({ ...filter, groupId: e.target.value || null })}>
          <option value="">Tüm değişiklikler</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              [{RISK_LABEL[g.riskLevel]}] {g.title}
            </option>
          ))}
        </select>
      </div>
      <Switch size="sm" checked={filter.onlyHighRisk} onChange={(v) => onChange({ ...filter, onlyHighRisk: v })} label="Yalnız yüksek risk" />
      <div className="gbar__field">
        <span className="gbar__label">Komşuluk</span>
        <Segmented<'1' | '2'>
          ariaLabel="Komşuluk derinliği"
          size="sm"
          value={filter.hops >= 2 ? '2' : '1'}
          onChange={(v) => onChange({ ...filter, hops: Number(v) })}
          options={[
            { value: '1', label: '1 adım' },
            { value: '2', label: '2 adım' },
          ]}
        />
      </div>
      <Switch size="sm" checked={filter.hideContains} onChange={(v) => onChange({ ...filter, hideContains: v })} label="Tip→üye kenarlarını gizle" />
      <span className="gbar__spacer" />
      <span className={`gbar__count gauge${heavy ? ' is-heavy' : ''}`} role="status">
        {shown.nodes}/{total} düğüm · {shown.edges} kenar
        {heavy && ' — çok büyük; grup ya da risk filtresi önerilir'}
      </span>
    </div>
  );
}

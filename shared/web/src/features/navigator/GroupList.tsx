import { useMemo, useState } from 'react';
import type { ChangeGroup } from '../../../../src/shared/types';
import { RiskBadge } from '../../components/RiskBadge';
import { VirtualList } from '../../components/VirtualList';
import type { GroupRow } from '../../lib/selectors';
import { groupRows } from '../../lib/selectors';
import { findAnchor, symbolLabel } from '../../lib/reviewIndex';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FileRow } from './FileRow';

const rowKey = (r: GroupRow) => r.key;

function estimate(r: GroupRow): number {
  switch (r.kind) {
    case 'head':
      return 96;
    case 'file':
      return 32;
    case 'more':
      return 30;
    case 'outside':
      return 44;
  }
}

function OutsideRow({ group, ids, hidden }: { group: ChangeGroup; ids: string[]; hidden: number }) {
  const { index } = useReviewCtx();
  const selectSymbol = useUi((s) => s.selectSymbol);
  return (
    <p className="group__outside">
      <span className="status status--impacted"><span className="status__glyph" aria-hidden="true">◌</span></span>
      Diff dışı:{' '}
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <button
            type="button"
            className="link-btn"
            title="Bu sembolü etkileyen değişikliğe git"
            onClick={() => {
              const via = findAnchor(index, id) ?? group.symbolIds.find((s) => index.symbolFile.has(s));
              if (via) selectSymbol(via, index.symbolFile.get(via));
            }}
          >
            {symbolLabel(index, id)}
          </button>
        </span>
      ))}
      {hidden > 0 && <span className="muted"> ve {hidden} sembol daha</span>}
    </p>
  );
}

/** Mantıksal değişiklik kümeleri ("hikâyeler"), riske göre sıralı; dev gruplarda ilk dosyalar gösterilir. */
export function GroupList() {
  const { index } = useReviewCtx();
  const filters = useUi((s) => s.filters);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => groupRows(index, filters, expanded), [index, filters, expanded]);

  if (index.groupsByRisk.length === 0) return <p className="nav__empty">Analiz grup üretmedi.</p>;
  if (rows.length === 0) return <p className="nav__empty">Filtrelerle eşleşen grup yok.</p>;

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <VirtualList<GroupRow>
      className="groups"
      ariaLabel="Değişiklik grupları"
      items={rows}
      itemKey={rowKey}
      estimate={estimate}
      itemClassName={(r) => `grow grow--${r.kind} risk-edge--${r.group.riskLevel}${r.last ? ' is-last' : ''}`}
      renderItem={(r) => <div className="grow__card">{renderRow(r)}</div>}
    />
  );

  function renderRow(r: GroupRow) {
    switch (r.kind) {
      case 'head':
        return (
          <div className="group__headblock">
            <div className="group__head">
              <h3 className="group__title">{r.group.title}</h3>
              <RiskBadge level={r.group.riskLevel} compact />
            </div>
            <p className="group__desc">{r.group.description}</p>
            <p className="group__meta gauge">
              {r.fileCount} dosya · {r.group.symbolIds.length} sembol
            </p>
          </div>
        );
      case 'file':
        return <FileRow file={r.file} compact />;
      case 'more':
        return (
          <button type="button" className="group__more" aria-expanded={r.open} onClick={() => toggle(r.group.id)}>
            {r.open ? 'İlk dosyaları göster' : `+${r.hidden} dosya daha`}
          </button>
        );
      case 'outside':
        return <OutsideRow group={r.group} ids={r.ids} hidden={r.hidden} />;
    }
  }
}

import { useMemo } from 'react';
import { VirtualList } from '../../components/VirtualList';
import type { PlanFold, PlanRow } from '../../lib/selectors';
import { planRows, planView } from '../../lib/selectors';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { PlanStepItem } from './PlanStepItem';

const rowKey = (r: PlanRow) => r.key;

/** Ölçülmemiş satır tahmini: gerekçe ~45 karakter/satır, sembol çipleri dar gezginde satır başına ~2. Yakın tahmin kaydırma çubuğunun zıplamasını azaltır. */
function estimate(r: PlanRow): number {
  if (r.kind === 'fold') return 52;
  const step = r.entry.step;
  const reasonLines = step?.reason ? Math.ceil(step.reason.length / 45) : 0;
  const chips = Math.min(step?.symbolIds.length ?? 0, 9);
  return 44 + reasonLines * 17 + (chips > 0 ? Math.ceil(chips / 2) * 24 + 6 : 0);
}

function FoldRow({ fold, open }: { fold: PlanFold; open: boolean }) {
  const toggle = useUi((s) => s.toggleFold);
  return (
    <div className={`plan-fold plan-fold--${fold.key}`}>
      <button type="button" className="plan-fold__toggle" aria-expanded={open} onClick={() => toggle(fold.key)}>
        <span className="plan-fold__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="plan-fold__text">
          <span className="plan-fold__title">{fold.title}</span>
          {fold.breakdown && <span className="plan-fold__sub">{fold.breakdown}</span>}
          {!open && <span className="plan-fold__sub">katlı · j/k ve n bu adımları atlar</span>}
        </span>
        <span className="gauge plan-fold__count">{fold.entries.length}</span>
      </button>
    </div>
  );
}

export function PlanList() {
  const { review, index } = useReviewCtx();
  const filters = useUi((s) => s.filters);
  const openFolds = useUi((s) => s.openFolds);
  const selected = useUi((s) => s.selectedFileId);
  const view = useMemo(() => planView(review, index, filters), [review, index, filters]);
  const rows = useMemo(() => planRows(view, openFolds), [view, openFolds]);

  if (rows.length === 0) {
    return <p className="nav__empty">Filtrelerle eşleşen dosya yok.</p>;
  }

  return (
    <VirtualList<PlanRow>
      className="plan"
      ariaLabel="Okuma planı"
      items={rows}
      itemKey={rowKey}
      estimate={estimate}
      activeKey={selected}
      renderItem={(r) => (r.kind === 'fold' ? <FoldRow fold={r.fold} open={r.open} /> : <PlanStepItem entry={r.entry} />)}
    />
  );
}

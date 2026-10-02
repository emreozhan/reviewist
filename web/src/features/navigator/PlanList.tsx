import { planView } from '../../lib/selectors';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { PlanStepItem } from './PlanStepItem';

export function PlanList() {
  const { review, index } = useReviewCtx();
  const filters = useUi((s) => s.filters);
  const showCosmetic = useUi((s) => s.showCosmeticSection);
  const toggleCosmetic = useUi((s) => s.toggleCosmeticSection);
  const view = planView(review, index, filters);

  if (view.main.length === 0 && view.cosmetic.length === 0) {
    return <p className="nav__empty">Filtrelerle eşleşen dosya yok.</p>;
  }

  return (
    <>
      <ol className="plan" aria-label="Okuma planı">
        {view.main.map((e) => (
          <PlanStepItem key={e.file.id} entry={e} />
        ))}
      </ol>
      {view.cosmetic.length > 0 && (
        <div className="plan-cosmetic">
          <button type="button" className="plan-cosmetic__toggle" aria-expanded={showCosmetic} onClick={toggleCosmetic}>
            <span aria-hidden="true">{showCosmetic ? '▾' : '▸'}</span> Kozmetik — güvenle atlanabilir
            <span className="gauge">{view.cosmetic.length}</span>
          </button>
          {showCosmetic && (
            <ol className="plan" aria-label="Kozmetik dosyalar">
              {view.cosmetic.map((e) => (
                <PlanStepItem key={e.file.id} entry={e} />
              ))}
            </ol>
          )}
        </div>
      )}
    </>
  );
}

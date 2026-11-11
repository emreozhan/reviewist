import { StatusGlyph } from '../../components/StatusGlyph';
import type { PlanEntry } from '../../lib/selectors';
import { symbolTail } from '../../lib/reviewIndex';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FileRow } from './FileRow';

/** Bir adımda gösterilen en fazla sembol çipi (fazlası "+N" olarak özetlenir). */
const MAX_CHIPS = 8;

/** Plan adımı: numaralı dosya satırı, gerekçe ve bu adımda bakılacak semboller. */
export function PlanStepItem({ entry }: { entry: PlanEntry }) {
  const { index } = useReviewCtx();
  const selectSymbol = useUi((s) => s.selectSymbol);
  const selectFile = useUi((s) => s.selectFile);
  const isSelectedFile = useUi((s) => s.selectedFileId === entry.file.id);
  // Yalnız bu adımın sembollerinden biri seçiliyse yeniden çizilir.
  const selectedSymbol = useUi((s) => (s.selectedFileId === entry.file.id ? s.selectedSymbolId : null));
  const symbols = entry.step?.symbolIds ?? [];
  const shown = symbols.slice(0, MAX_CHIPS);

  return (
    <div className={`plan__step${isSelectedFile ? ' is-current' : ''}`}>
      <FileRow file={entry.file} order={entry.order} />
      {entry.step?.reason && <p className="plan__reason">{entry.step.reason}</p>}
      {symbols.length > 0 && (
        <ul className="plan__syms" aria-label="Bu adımdaki semboller">
          {shown.map((id) => {
            const m = index.memberById.get(id);
            const status = m?.status ?? index.typeById.get(id)?.status ?? 'modified';
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`sym-chip${selectedSymbol === id ? ' is-active' : ''}`}
                  onClick={() => selectSymbol(id, entry.file.id)}
                >
                  <StatusGlyph status={status} size="sm" />
                  {symbolTail(index, id)}
                </button>
              </li>
            );
          })}
          {symbols.length > shown.length && (
            <li>
              <button type="button" className="sym-chip sym-chip--more" onClick={() => selectFile(entry.file.id)} title="Tüm semboller dosyanın Yapı görünümünde">
                +{symbols.length - shown.length}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

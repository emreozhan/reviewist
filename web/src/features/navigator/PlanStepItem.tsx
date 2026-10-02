import { StatusGlyph } from '../../components/StatusGlyph';
import type { PlanEntry } from '../../lib/selectors';
import { symbolLabel } from '../../lib/reviewIndex';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FileRow } from './FileRow';

/** Plan adımı: numaralı dosya satırı, gerekçe ve bu adımda bakılacak semboller. */
export function PlanStepItem({ entry }: { entry: PlanEntry }) {
  const { index } = useReviewCtx();
  const selectSymbol = useUi((s) => s.selectSymbol);
  const selectedSymbol = useUi((s) => s.selectedSymbolId);
  const isSelectedFile = useUi((s) => s.selectedFileId === entry.file.id);
  const symbols = entry.step?.symbolIds ?? [];

  return (
    <li className={`plan__step${isSelectedFile ? ' is-current' : ''}`}>
      <FileRow file={entry.file} order={entry.order} />
      {entry.step?.reason && <p className="plan__reason">{entry.step.reason}</p>}
      {symbols.length > 0 && (
        <ul className="plan__syms" aria-label="Bu adımdaki semboller">
          {symbols.map((id) => {
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
                  {symbolLabel(index, id).split('.').slice(-1)[0]}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

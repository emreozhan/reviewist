import { useOpenLocation } from '../../hooks/useNavigation';
import { SEVERITY_LABEL } from '../../lib/labels';
import { baseName } from '../../lib/reviewIndex';
import { SEVERITY_RANK } from '../../lib/selectors';
import { useReviewCtx } from '../workspace/ReviewContext';

/** Gezginde kısa bulgu listesi; ayrıntılı görünüm "Bulgular" sekmesinde. */
export function FindingsNavList() {
  const { review } = useReviewCtx();
  const open = useOpenLocation();
  const items = [...review.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  if (items.length === 0) return <p className="nav__empty">Bulgu yok.</p>;

  return (
    <ul className="fnav">
      {items.map((f) => (
        <li key={f.id}>
          <button type="button" className={`fnav__item sev--${f.severity}`} onClick={() => open({ file: f.file, line: f.line, symbolIds: f.symbolIds })}>
            <span className={`sev-mark sev-mark--${f.severity}`} aria-hidden="true" />
            <span className="sr-only">{SEVERITY_LABEL[f.severity]}:</span>
            <span className="fnav__title">{f.title}</span>
            {f.file && (
              <span className="fnav__loc">
                {baseName(f.file)}
                {f.line ? `:${f.line}` : ''}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

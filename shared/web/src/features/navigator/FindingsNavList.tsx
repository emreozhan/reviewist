import { useMemo } from 'react';
import type { Finding } from '../../../../src/shared/types';
import { VirtualList } from '../../components/VirtualList';
import { useOpenLocation } from '../../hooks/useNavigation';
import { SEVERITY_LABEL } from '../../lib/labels';
import { baseName } from '../../lib/reviewIndex';
import { filterFindings } from '../../lib/selectors';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FindingFilterBar } from '../findings/FindingFilterBar';

const findingKey = (f: Finding) => f.id;
const estimate = () => 50;

/** Gezginde kısa bulgu listesi (önem + kategori filtreli); ayrıntılı görünüm "Bulgular" sekmesinde. */
export function FindingsNavList() {
  const { review } = useReviewCtx();
  const filter = useUi((s) => s.findingFilter);
  const open = useOpenLocation();
  const items = useMemo(() => filterFindings(review.findings, filter), [review.findings, filter]);

  return (
    <div className="fnav-wrap">
      <FindingFilterBar compact />
      {items.length === 0 ? (
        <p className="nav__empty">{review.findings.length === 0 ? 'Bulgu yok.' : 'Bu filtreyle bulgu yok.'}</p>
      ) : (
        <VirtualList<Finding>
          className="fnav"
          ariaLabel="Bulgular"
          items={items}
          itemKey={findingKey}
          estimate={estimate}
          renderItem={(f) => (
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
          )}
        />
      )}
    </div>
  );
}

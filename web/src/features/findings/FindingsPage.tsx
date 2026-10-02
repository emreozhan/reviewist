import { useMemo } from 'react';
import { VirtualList } from '../../components/VirtualList';
import type { FindingRow } from '../../lib/selectors';
import { CATEGORY_LABEL, filterFindings, findingRows, groupFindings } from '../../lib/selectors';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FindingCard } from './FindingCard';
import { FindingFilterBar } from './FindingFilterBar';

const rowKey = (r: FindingRow) => r.key;
const estimate = (r: FindingRow) => (r.kind === 'cat' ? 44 : 112);

/** Bulgular: önem + kategori filtreli, kategoriye göre gruplu; binlerce bulguda pencereli çizilir. */
export function FindingsPage() {
  const { review, index } = useReviewCtx();
  const filter = useUi((s) => s.findingFilter);
  const counts = index.findingCounts.total;
  const rows = useMemo(() => findingRows(groupFindings(filterFindings(review.findings, filter))), [review.findings, filter]);
  const shown = rows.reduce((n, r) => n + (r.kind === 'finding' ? 1 : 0), 0);

  return (
    <div className="findings">
      <div className="findings__bar">
        <h2 className="findings__title">Bulgular</h2>
        <p className="findings__counts">
          <span className="sev-count sev--error"><span className="sev-mark sev-mark--error" aria-hidden="true" /> {counts.error} hata</span>
          <span className="sev-count sev--warning"><span className="sev-mark sev-mark--warning" aria-hidden="true" /> {counts.warning} uyarı</span>
          <span className="sev-count sev--info"><span className="sev-mark sev-mark--info" aria-hidden="true" /> {counts.info} bilgi</span>
          <span className="findings__shown gauge">{shown} gösteriliyor</span>
        </p>
        <FindingFilterBar />
      </div>
      {rows.length === 0 ? (
        <p className="muted findings__empty">Bu filtreyle bulgu yok. Önem filtresini “Tümü” yapmayı deneyin.</p>
      ) : (
        <VirtualList<FindingRow>
          className="findings__list"
          ariaLabel="Bulgu listesi"
          items={rows}
          itemKey={rowKey}
          estimate={estimate}
          threshold={80}
          itemClassName={(r) => (r.kind === 'cat' ? 'frow-cat' : 'frow-card')}
          renderItem={(r) =>
            r.kind === 'cat' ? (
              <h3 className={`fgroup__title sev--${r.worst}`}>
                <span className={`sev-mark sev-mark--${r.worst}`} aria-hidden="true" />
                {CATEGORY_LABEL[r.category]}
                <span className="gauge">{r.count}</span>
              </h3>
            ) : (
              <FindingCard finding={r.finding} />
            )
          }
        />
      )}
    </div>
  );
}

import { useState } from 'react';
import type { Finding } from '../../../../src/shared/types';
import { Segmented } from '../../components/Segmented';
import { CATEGORY_LABEL, groupFindings } from '../../lib/selectors';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FindingCard } from './FindingCard';

type Level = 'all' | 'warning' | 'error';

/** Bulgular: kategoriye göre gruplu, en ağır önemden başlayarak; tıklanınca ilgili dosya/satıra gider. */
export function FindingsPage() {
  const { review } = useReviewCtx();
  const [level, setLevel] = useState<Level>('all');
  const counts = { error: 0, warning: 0, info: 0 } satisfies Record<Finding['severity'], number>;
  for (const f of review.findings) counts[f.severity]++;
  const groups = groupFindings(review.findings, level === 'all' ? undefined : level);

  return (
    <div className="findings">
      <div className="findings__bar">
        <h2 className="findings__title">Bulgular</h2>
        <p className="findings__counts">
          <span className="sev-count sev--error"><span className="sev-mark sev-mark--error" aria-hidden="true" /> {counts.error} hata</span>
          <span className="sev-count sev--warning"><span className="sev-mark sev-mark--warning" aria-hidden="true" /> {counts.warning} uyarı</span>
          <span className="sev-count sev--info"><span className="sev-mark sev-mark--info" aria-hidden="true" /> {counts.info} bilgi</span>
        </p>
        <Segmented<Level>
          ariaLabel="Önem filtresi"
          size="sm"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'Tümü' },
            { value: 'warning', label: 'Hata + uyarı' },
            { value: 'error', label: 'Yalnız hata' },
          ]}
        />
      </div>
      {groups.length === 0 ? (
        <p className="muted findings__empty">Bu filtreyle bulgu yok.</p>
      ) : (
        <div className="findings__grid">
          {groups.map((g) => (
            <section key={g.category} className={`fgroup sev--${g.worst}`} aria-labelledby={`fg-${g.category}`}>
              <h3 id={`fg-${g.category}`} className="fgroup__title">
                {CATEGORY_LABEL[g.category]}
                <span className="gauge">{g.items.length}</span>
              </h3>
              <div className="fgroup__items">
                {g.items.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

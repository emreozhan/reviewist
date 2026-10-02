import { useMemo } from 'react';
import type { Finding } from '../../../../src/shared/types';
import { Segmented } from '../../components/Segmented';
import { CATEGORY_LABEL, categoryCounts } from '../../lib/selectors';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';

type Severity = Finding['severity'];

/** Önem filtresi (varsayılan hata + uyarı) ve kategori sayaçları; gezgin ve Bulgular sayfası aynı filtreyi paylaşır. */
export function FindingFilterBar({ compact = false }: { compact?: boolean }) {
  const { index } = useReviewCtx();
  const filter = useUi((s) => s.findingFilter);
  const setFilter = useUi((s) => s.setFindingFilter);
  const total = index.findingCounts.total;
  const cats = useMemo(() => categoryCounts(index, filter.minSeverity), [index, filter.minSeverity]);
  const shownTotal = cats.reduce((n, c) => n + c.count, 0);

  return (
    <div className={`ffilter${compact ? ' ffilter--compact' : ''}`}>
      <Segmented<Severity>
        ariaLabel="Önem filtresi"
        size="sm"
        value={filter.minSeverity}
        onChange={(v) => setFilter({ minSeverity: v })}
        options={[
          { value: 'error', label: 'Hata', badge: total.error, title: 'Yalnız hatalar' },
          { value: 'warning', label: compact ? '+ Uyarı' : 'Hata + uyarı', badge: total.error + total.warning, title: 'Hatalar ve uyarılar (varsayılan)' },
          { value: 'info', label: 'Tümü', badge: total.error + total.warning + total.info, title: 'Bilgi notları dahil' },
        ]}
      />
      <div className="ffilter__cats" role="group" aria-label="Kategori filtresi">
        <button type="button" className={`ffilter__cat${filter.category === null ? ' is-on' : ''}`} aria-pressed={filter.category === null} onClick={() => setFilter({ category: null })}>
          Tümü <span className="gauge">{shownTotal}</span>
        </button>
        {cats.map((c) => (
          <button
            key={c.category}
            type="button"
            className={`ffilter__cat sev--${c.worst}${filter.category === c.category ? ' is-on' : ''}${c.count === 0 ? ' is-empty' : ''}`}
            aria-pressed={filter.category === c.category}
            title={`${CATEGORY_LABEL[c.category]}: bu önem filtresiyle ${c.count}, toplam ${c.total}`}
            onClick={() => setFilter({ category: filter.category === c.category ? null : c.category })}
          >
            <span className={`sev-mark sev-mark--${c.worst}`} aria-hidden="true" />
            {CATEGORY_LABEL[c.category]} <span className="gauge">{c.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

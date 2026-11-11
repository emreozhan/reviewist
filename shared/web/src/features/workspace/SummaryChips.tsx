import type { ReactNode } from 'react';
import { useSetTab } from '../../hooks/useNavigation';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from './ReviewContext';

interface Readout {
  key: string;
  label: string;
  value: ReactNode;
  tone?: 'risk' | 'impacted' | 'warn' | 'muted';
  title: string;
  onClick?: () => void;
  pressed?: boolean;
}

/** Özet göstergeleri: ölçüm aletinin okuma pencereleri gibi; filtre bağlantılı olanlar düğmedir. */
export function SummaryChips() {
  const { review } = useReviewCtx();
  const s = review.summary;
  const filters = useUi((st) => st.filters);
  const setFilters = useUi((st) => st.setFilters);
  const setTab = useSetTab();

  const readouts: Readout[] = [
    { key: 'files', label: 'Dosya', value: <>{s.files}<small> · {s.javaFiles} java · {s.testFiles} test</small></>, title: `${s.files} dosya değişti` },
    { key: 'lines', label: 'Satır', value: <><span className="delta__add">+{s.additions}</span> <span className="delta__del">−{s.deletions}</span></>, title: 'Eklenen / silinen satır' },
    { key: 'types', label: 'Tip / üye', value: <>{s.typesChanged}<small> / </small>{s.membersChanged}</>, title: 'Değişen tip ve üye sayısı' },
    { key: 'api', label: 'Public API', value: s.publicApiChanges, tone: s.publicApiChanges > 0 ? 'warn' : 'muted', title: 'Public API değişikliği (imza, silme, ad değişikliği, taşıma)' },
    {
      key: 'risk', label: 'Yüksek risk', value: s.highRiskItems, tone: s.highRiskItems > 0 ? 'risk' : 'muted',
      title: 'Yüksek/kritik riskli sembol sayısı — tıklayınca gezgini yalnız yüksek riskle filtreler',
      onClick: () => { setFilters({ onlyHighRisk: !filters.onlyHighRisk }); setTab('workspace'); }, pressed: filters.onlyHighRisk,
    },
    {
      key: 'impacted', label: 'Diff dışı etkilenen', value: s.impactedOutsideDiff, tone: s.impactedOutsideDiff > 0 ? 'impacted' : 'muted',
      title: 'Değişmediği halde değişen koda bağlı sembol (çağıran, alt sınıf) — etki haritasında göster', onClick: () => setTab('graph'),
    },
    { key: 'untested', label: 'Testsiz', value: s.untestedChanges, tone: s.untestedChanges > 0 ? 'warn' : 'muted', title: 'İlgili testi bulunamayan değişen üretim tipi' },
    {
      key: 'cosmetic', label: 'Kozmetik', value: s.cosmeticFiles, tone: 'muted',
      title: 'Yalnız biçim/import değişikliği olan dosyalar — tıklayınca gizle/göster',
      onClick: () => setFilters({ hideCosmetic: !filters.hideCosmetic }), pressed: filters.hideCosmetic,
    },
  ];

  return (
    <ul className="readouts" aria-label="Değişiklik özeti">
      {readouts.map((r) => {
        const inner = (
          <>
            <span className="readout__label">{r.label}</span>
            <span className="readout__value">{r.value}</span>
          </>
        );
        return (
          <li key={r.key} className={`readout${r.tone ? ` readout--${r.tone}` : ''}`}>
            {r.onClick ? (
              <button type="button" className="readout__btn" title={r.title} onClick={r.onClick} aria-pressed={r.pressed}>
                {inner}
              </button>
            ) : (
              <span className="readout__static" title={r.title}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

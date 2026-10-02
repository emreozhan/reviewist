import { useEffect, useState } from 'react';

const STAGES = [
  { at: 0, label: 'Değişiklikler okunuyor', sub: 'git diff / PR dosyaları' },
  { at: 2, label: 'Java dosyaları ayrıştırılıyor', sub: 'tree-sitter ile tip ve üyeler' },
  { at: 5, label: 'Repo indeksi kuruluyor', sub: 'diff dışındaki .java dosyaları' },
  { at: 9, label: 'Çağıranlar ve alt tipler çözülüyor', sub: 'yayılım grafiği' },
  { at: 14, label: 'Risk ve okuma planı hesaplanıyor', sub: 'gruplar, bulgular' },
];

interface AnalysisProgressProps {
  onCancel: () => void;
}

/** Sunucu ilerleme akışı vermediği için aşamalar geçen süreye göre tahmin edilir; bu açıkça belirtilir. */
export function AnalysisProgress({ onCancel }: AnalysisProgressProps) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const t = window.setInterval(() => setElapsed((performance.now() - started) / 1000), 250);
    return () => window.clearInterval(t);
  }, []);
  const current = STAGES.reduce((idx, s, i) => (elapsed >= s.at ? i : idx), 0);

  return (
    <section className="analysis" aria-live="polite" aria-busy="true" aria-label="Analiz sürüyor">
      <div className="analysis__scope" aria-hidden="true">
        <span className="analysis__sweep" />
      </div>
      <ol className="analysis__stages">
        {STAGES.map((s, i) => (
          <li key={s.label} className={`analysis__stage${i < current ? ' is-done' : ''}${i === current ? ' is-current' : ''}`}>
            <span className="analysis__tick" aria-hidden="true">{i < current ? '✓' : i === current ? '›' : ''}</span>
            <span className="analysis__label">{s.label}</span>
            <span className="analysis__sub">{s.sub}</span>
          </li>
        ))}
      </ol>
      <div className="analysis__foot">
        <span className="gauge">{elapsed.toFixed(1)} sn</span>
        <span className="muted">Aşamalar tahminidir; büyük depolarda indeksleme birkaç dakika sürebilir.</span>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          İptal et
        </button>
      </div>
    </section>
  );
}

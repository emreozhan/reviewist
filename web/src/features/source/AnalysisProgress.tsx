import { useEffect, useState } from 'react';
import type { AnalysisProgressState } from '../../lib/analysisRunner';

interface AnalysisProgressProps {
  progress: AnalysisProgressState;
  onCancel: () => void;
}

/** En fazla bu kadar geçmiş mesaj gösterilir (en yenisi en altta). */
const MAX_VISIBLE = 7;

function useElapsed(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const t = window.setInterval(() => setElapsed((performance.now() - started) / 1000), 250);
    return () => window.clearInterval(t);
  }, []);
  return elapsed;
}

/** Sunucunun gönderdiği gerçek ilerleme mesajları; eski sunucuda (senkron uç) yalnız geçen süre. */
export function AnalysisProgress({ progress, onCancel }: AnalysisProgressProps) {
  const elapsed = useElapsed();
  const { messages, mode } = progress;
  const hidden = Math.max(0, messages.length - MAX_VISIBLE);
  const visible = messages.slice(hidden);

  return (
    <section className="analysis" aria-busy="true" aria-label="Analiz sürüyor">
      <div className="analysis__scope" aria-hidden="true">
        <span className="analysis__sweep" />
      </div>
      <ol className="analysis__stages" aria-live="polite">
        {hidden > 0 && <li className="analysis__more muted">… önceki {hidden} adım</li>}
        {visible.map((m, i) => {
          const last = i === visible.length - 1;
          return (
            <li key={`${hidden + i}-${m.at}`} className={`analysis__stage${last ? ' is-current' : ' is-done'}`}>
              <span className="analysis__tick" aria-hidden="true">{last ? '›' : '✓'}</span>
              <span className="analysis__label">{m.message}</span>
            </li>
          );
        })}
        {messages.length === 0 && (
          <li className="analysis__stage is-current">
            <span className="analysis__tick" aria-hidden="true">›</span>
            <span className="analysis__label">{mode === 'sync' ? 'Analiz sürüyor' : 'Analiz başlatılıyor'}</span>
            {mode === 'sync' && <span className="analysis__sub">Sunucu ilerleme bildirmiyor (eski sürüm); sonuç tek seferde gelecek.</span>}
          </li>
        )}
      </ol>
      <div className="analysis__foot">
        <span className="gauge">{elapsed.toFixed(1)} sn</span>
        <span className="muted">Büyük depolarda indeksleme birkaç dakika sürebilir.</span>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          İptal et
        </button>
      </div>
    </section>
  );
}

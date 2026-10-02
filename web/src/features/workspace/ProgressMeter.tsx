import { orderedEntries } from '../../lib/selectors';
import { useProgress } from '../../state/progressStore';
import { useReviewCtx } from './ReviewContext';

/** Görüldü ilerlemesi: plan sırasına göre dosya başına bir çentik (çok dosyada sürekli çubuk). */
export function ProgressMeter() {
  const { review, index } = useReviewCtx();
  const seen = useProgress((s) => s.seen);
  const saveFailed = useProgress((s) => s.saveFailed);
  const entries = orderedEntries(review, index);
  const done = entries.filter((e) => seen[e.file.id]).length;
  const pct = entries.length === 0 ? 0 : Math.round((done / entries.length) * 100);
  const ticks = entries.length <= 60;

  return (
    <div className="progress" title={saveFailed ? 'Uyarı: ilerleme tarayıcıya kaydedilemedi' : undefined}>
      <span className="progress__label">
        Görüldü <strong className="gauge">{done}/{entries.length}</strong>
        {saveFailed && <span className="progress__warn"> · kaydedilemedi</span>}
      </span>
      <div className="progress__track" role="progressbar" aria-label="Görülen dosya oranı" aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={done} aria-valuetext={`${done} / ${entries.length} dosya görüldü (%${pct})`}>
        {ticks ? (
          entries.map((e) => (
            <span
              key={e.file.id}
              className={`progress__tick${seen[e.file.id] ? ' is-seen' : ''}${e.file.cosmeticOnly ? ' is-cosmetic' : ''} risk-tick--${e.file.risk.level}`}
            />
          ))
        ) : (
          <span className="progress__fill" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

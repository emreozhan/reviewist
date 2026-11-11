import type { LoadProgress } from '../../lib/apiTypes';
import { describeLoad, useLoad } from '../../state/loadStore';

const PHASES: { key: LoadProgress['phase']; label: string }[] = [
  { key: 'download', label: 'İndir' },
  { key: 'parse', label: 'Ayrıştır' },
  { key: 'index', label: 'İndeksle' },
];

/** Aşama + bayt göstergesi; toplam bilinmiyorsa (gzip) belirsiz çubuk. */
export function LoadMeter({ progress }: { progress: LoadProgress | undefined }) {
  const phaseIdx = progress ? PHASES.findIndex((p) => p.key === progress.phase) : -1;
  const pct = progress?.phase === 'download' && progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : undefined;
  return (
    <div className="loadm">
      <ol className="loadm__phases" aria-label="Yükleme aşamaları">
        {PHASES.map((p, i) => (
          <li key={p.key} className={`loadm__phase${i < phaseIdx ? ' is-done' : i === phaseIdx ? ' is-current' : ''}`}>
            {p.label}
          </li>
        ))}
      </ol>
      <div
        className={`loadm__track${pct === undefined ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label="İnceleme yükleniyor"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={progress ? describeLoad(progress) : 'Bağlanılıyor'}
      >
        <span className="loadm__fill" style={pct !== undefined ? { width: `${pct}%` } : undefined} />
      </div>
      <p className="loadm__text gauge" aria-live="polite">
        {progress ? describeLoad(progress) : 'Sunucuya bağlanılıyor…'}
      </p>
    </div>
  );
}

/** Review açılırken: büyük modelde (onlarca MB) indirme/ayrıştırma/indeksleme ilerlemesi. */
export function LoadingState({ id }: { id: string }) {
  const progress = useLoad((s) => s.byId[id]);
  return (
    <div className="screen-state" aria-busy="true">
      <span className="screen-state__pulse" aria-hidden="true" />
      <p>İnceleme yükleniyor…</p>
      <LoadMeter progress={progress} />
    </div>
  );
}

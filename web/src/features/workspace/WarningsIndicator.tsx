import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useSetTab } from '../../hooks/useNavigation';
import { baseName } from '../../lib/reviewIndex';
import { summarizeWarnings, WARNING_KIND_LABEL } from '../../lib/warnings';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from './ReviewContext';

/** Panelde grup başına gösterilen en fazla satır. */
const MAX_PER_GROUP = 50;

/** Üst şeritte analiz uyarıları sayacı; tıklanınca türlerine göre gruplu panel açılır. */
export function WarningsIndicator() {
  const { review } = useReviewCtx();
  const summary = useMemo(() => summarizeWarnings(review), [review]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectFile = useUi((s) => s.selectFile);
  const setTab = useSetTab();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (summary.total === 0) return null;

  return (
    <div className="menu warn-ind" ref={rootRef}>
      <button
        type="button"
        className={`btn btn--sm warn-ind__btn${open ? ' is-open' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="Analiz uyarıları: ayrıştırma hataları, indeks limiti vb. Sonuçlar eksik olabilir."
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="warning" /> <span className="btn__label">Uyarılar</span>
        <span className="warn-ind__count gauge">{summary.total}</span>
      </button>
      {open && (
        <div className="menu__pop warn-pop" role="dialog" aria-label="Analiz uyarıları">
          <p className="warn-pop__lead">Analiz bu sorunlarla tamamlandı; ilgili sonuçlar eksik ya da yaklaşık olabilir.</p>
          {summary.parseErrorFiles.length > 0 && (
            <section className="warn-pop__sec">
              <h3 className="warn-pop__h">
                Ayrıştırılamayan diff dosyaları <span className="gauge">{summary.parseErrorFiles.length}</span>
              </h3>
              <ul className="warn-pop__list">
                {summary.parseErrorFiles.slice(0, MAX_PER_GROUP).map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className="link-btn"
                      title={f.path}
                      onClick={() => {
                        selectFile(f.path);
                        setTab('workspace');
                        setOpen(false);
                      }}
                    >
                      {baseName(f.path)}
                    </button>
                    <span className="warn-pop__detail">{f.error}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {summary.groups.map((g) => (
            <section key={g.kind} className={`warn-pop__sec warn-pop__sec--${g.kind}`}>
              <h3 className="warn-pop__h">
                {WARNING_KIND_LABEL[g.kind]} <span className="gauge">{g.messages.length}</span>
              </h3>
              <ul className="warn-pop__list">
                {g.messages.slice(0, MAX_PER_GROUP).map((m, i) => (
                  <li key={`${i}-${m}`}>{m}</li>
                ))}
                {g.messages.length > MAX_PER_GROUP && <li className="muted">… ve {g.messages.length - MAX_PER_GROUP} uyarı daha</li>}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

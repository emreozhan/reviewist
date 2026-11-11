import { Icon } from '../../components/Icon';
import { useCodeNav } from '../../hooks/useCodeNav';
import { baseName } from '../../lib/reviewIndex';
import { breadcrumb } from '../../lib/tabs';
import { useTabs } from '../../state/tabsStore';
import { altLabel } from '../../lib/platform';

/** Gösterilen en fazla geçmiş adımı (imlecin gerisinde). */
const MAX_CRUMBS = 6;

/**
 * Gezinme geçmişi: Geri/İleri (Alt+←/Alt+→) ve son atlamaların kırıntı izi (A.notify() → B.deliver() → C.send()).
 * Bir adıma tıklamak o konuma döner; ileri adımlar soluk gösterilir.
 */
export function HistoryTrail() {
  const history = useTabs((s) => s.history);
  const cursor = useTabs((s) => s.cursor);
  const nav = useCodeNav();
  const crumbs = breadcrumb({ tabs: [], activeKey: null, history, cursor }, MAX_CRUMBS);
  const hidden = crumbs[0] ? crumbs[0].index : 0;

  return (
    <div className="trail">
      <button type="button" className="icon-btn icon-btn--sm" onClick={nav.back} disabled={cursor <= 0} aria-label="Geri" title={`Geri (${altLabel}+←)`}>
        <Icon name="arrowLeft" />
      </button>
      <button type="button" className="icon-btn icon-btn--sm" onClick={nav.forward} disabled={cursor >= history.length - 1} aria-label="İleri" title={`İleri (${altLabel}+→)`}>
        <Icon name="arrowRight" />
      </button>
      <nav className="trail__nav" aria-label="Gezinme izi">
        {crumbs.length === 0 ? (
          <span className="trail__empty">Bir metoda tıkladığınızda izlediğiniz akış burada birikir.</span>
        ) : (
          <ol className="trail__list">
            {hidden > 0 && (
              <li className="trail__more" title={`${hidden} eski adım`}>
                …
              </li>
            )}
            {crumbs.map((c) => (
              <li key={c.index} className={`trail__item${c.current ? ' is-current' : ''}${c.forward ? ' is-forward' : ''}${c.entry.inDiff ? '' : ' is-outside'}`}>
                <button
                  type="button"
                  className="trail__btn"
                  aria-current={c.current ? 'step' : undefined}
                  disabled={c.current}
                  onClick={() => nav.jump(c.index)}
                  title={`${c.entry.crumb} — ${baseName(c.entry.path)}${c.entry.line ? `:${c.entry.line}` : ''}${c.entry.inDiff ? '' : ' (diff dışı)'}`}
                >
                  {c.entry.crumb}
                </button>
              </li>
            ))}
          </ol>
        )}
      </nav>
    </div>
  );
}

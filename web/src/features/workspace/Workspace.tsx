import { Icon } from '../../components/Icon';
import { useUi } from '../../state/uiStore';
import { Inspector } from '../inspector/Inspector';
import { Navigator } from '../navigator/Navigator';
import { CenterPanel } from './CenterPanel';

/** Üç panelli çalışma alanı: gezgin | dosya (yapı/diff) | denetçi. Yan paneller daraltılabilir. */
export function Workspace() {
  const navCollapsed = useUi((s) => s.navCollapsed);
  const inspectorCollapsed = useUi((s) => s.inspectorCollapsed);
  const toggleNav = useUi((s) => s.toggleNav);
  const toggleInspector = useUi((s) => s.toggleInspector);

  return (
    <div className={`ws${navCollapsed ? ' ws--nav-collapsed' : ''}${inspectorCollapsed ? ' ws--insp-collapsed' : ''}`}>
      <aside className="ws__nav" aria-label="Gezgin">
        {navCollapsed ? (
          <button type="button" className="ws__rail" onClick={toggleNav} aria-label="Gezgini aç" title="Gezgini aç">
            <Icon name="panelLeft" />
            <span className="ws__rail-text">Gezgin</span>
          </button>
        ) : (
          <Navigator onCollapse={toggleNav} />
        )}
      </aside>
      <section className="ws__center" aria-label="Seçili dosya">
        <CenterPanel />
      </section>
      <aside className="ws__insp" aria-label="Denetçi">
        {inspectorCollapsed ? (
          <button type="button" className="ws__rail" onClick={toggleInspector} aria-label="Denetçiyi aç" title="Denetçiyi aç">
            <Icon name="panelRight" />
            <span className="ws__rail-text">Denetçi</span>
          </button>
        ) : (
          <Inspector onCollapse={toggleInspector} />
        )}
      </aside>
    </div>
  );
}

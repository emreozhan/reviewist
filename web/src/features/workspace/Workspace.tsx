import { memo, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { Splitter } from '../../components/Splitter';
import { clampPanelWidth, PANEL_LIMITS, RAIL_W } from '../../lib/panelSizes';
import { useLayout, wideWidth } from '../../state/layoutStore';
import { Inspector } from '../inspector/Inspector';
import { Navigator } from '../navigator/Navigator';
import { CenterPanel } from './CenterPanel';

function subscribeResize(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}
const viewportWidth = () => window.innerWidth;

// Ayraç sürüklenirken (her karede genişlik değişir) panel içerikleri yeniden çizilmesin.
const NavigatorPanel = memo(Navigator);
const CenterPanelM = memo(CenterPanel);
const InspectorPanel = memo(Inspector);

/**
 * Üç panelli çalışma alanı: gezgin | sekmeli dosya alanı | denetçi.
 * Yan paneller ayraçla genişletilir/daraltılır; odak modunda (f) yalnız orta panel kalır.
 */
export function Workspace() {
  const vw = useSyncExternalStore(subscribeResize, viewportWidth, viewportWidth);
  const { navW, inspW, navCollapsed, inspCollapsed, wide, focusMode } = useLayout(
    useShallow((s) => ({ navW: s.navW, inspW: s.inspW, navCollapsed: s.navCollapsed, inspCollapsed: s.inspCollapsed, wide: s.wide, focusMode: s.focusMode })),
  );
  const setCollapsed = useLayout((s) => s.setCollapsed);

  const rawNav = navCollapsed ? RAIL_W : wide === 'nav' ? wideWidth('nav') : navW;
  const rawInsp = inspCollapsed ? RAIL_W : wide === 'insp' ? wideWidth('insp') : inspW;
  // Pencere daralınca orta panele yer kalsın: önce genişletilmiş/etkin olmayan panel kısılır.
  const insp = inspCollapsed ? RAIL_W : clampPanelWidth('insp', rawInsp, vw, Math.min(rawNav, PANEL_LIMITS.nav.min));
  const nav = navCollapsed ? RAIL_W : clampPanelWidth('nav', rawNav, vw, insp);
  const style = { '--nav-w': `${nav}px`, '--insp-w': `${insp}px` } as CSSProperties;

  return (
    <div className={`ws${navCollapsed ? ' ws--nav-collapsed' : ''}${inspCollapsed ? ' ws--insp-collapsed' : ''}${focusMode ? ' ws--focus' : ''}`} style={style}>
      <aside className="ws__nav" aria-label="Gezgin" hidden={focusMode}>
        {navCollapsed ? (
          <button type="button" className="ws__rail" onClick={() => setCollapsed('nav', false)} aria-label="Gezgini aç" title="Gezgini aç">
            <Icon name="panelLeft" />
            <span className="ws__rail-text">Gezgin</span>
          </button>
        ) : (
          <NavigatorPanel />
        )}
      </aside>
      {!focusMode && <Splitter panel="nav" width={nav} otherWidth={insp} collapsed={navCollapsed} />}
      <section className="ws__center" aria-label="Dosya sekmeleri">
        <CenterPanelM />
      </section>
      {!focusMode && <Splitter panel="insp" width={insp} otherWidth={nav} collapsed={inspCollapsed} />}
      <aside className="ws__insp" aria-label="Denetçi" hidden={focusMode}>
        {inspCollapsed ? (
          <button type="button" className="ws__rail" onClick={() => setCollapsed('insp', false)} aria-label="Denetçiyi aç" title="Denetçiyi aç">
            <Icon name="panelRight" />
            <span className="ws__rail-text">Denetçi</span>
          </button>
        ) : (
          <InspectorPanel />
        )}
      </aside>
    </div>
  );
}

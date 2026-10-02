import { lazy, Suspense } from 'react';
import { useRouteSelectionSync } from '../../hooks/useRouteSelectionSync';
import { useShortcuts } from '../../hooks/useShortcuts';
import type { RouteParams, Tab } from '../../lib/route';
import { useUi } from '../../state/uiStore';
import { FindingsPage } from '../findings/FindingsPage';
import { useReviewCtx } from './ReviewContext';
import { ShortcutHelp } from './ShortcutHelp';
import { TopBar } from './TopBar';
import { Workspace } from './Workspace';

/** Etki haritası (React Flow + dagre) ayrı parçada yüklenir. */
const ImpactMap = lazy(async () => ({ default: (await import('../graph/ImpactMap')).ImpactMap }));

interface ReviewLayoutProps {
  tab: Tab;
  params: RouteParams;
}

export function ReviewLayout({ tab, params }: ReviewLayoutProps) {
  const { review, index } = useReviewCtx();
  const helpOpen = useUi((s) => s.helpOpen);
  useShortcuts(tab);
  useRouteSelectionSync(review, index, tab, params);

  return (
    <div className="review">
      <TopBar tab={tab} />
      <main className="review__main" id="main">
        {tab === 'workspace' && <Workspace />}
        {tab === 'graph' && (
          <Suspense fallback={<p className="center__note">Etki haritası yükleniyor…</p>}>
            <ImpactMap />
          </Suspense>
        )}
        {tab === 'findings' && <FindingsPage />}
      </main>
      {helpOpen && <ShortcutHelp />}
    </div>
  );
}

import { lazy, Suspense, useEffect } from 'react';
import { useRouteSelectionSync } from '../../hooks/useRouteSelectionSync';
import { useShortcuts } from '../../hooks/useShortcuts';
import { useTabShortcuts } from '../../hooks/useTabShortcuts';
import { useTabSync } from '../../hooks/useTabSync';
import { useLayout } from '../../state/layoutStore';
import type { RouteParams, Tab } from '../../lib/route';
import { usePeek } from '../../state/peekStore';
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
  const focusMode = useLayout((s) => s.focusMode);
  useShortcuts(tab);
  useTabShortcuts();
  // Sıra önemli: sekme senkronu, adresin uyguladığı ilk seçimi yakalayacak şekilde önce abone olur.
  useTabSync(review, index);
  useRouteSelectionSync(review, index, tab, params);
  // Gözatma yığını yalnız inceleme değişince sıfırlanır (burada, her zaman bağlı katmanda): grafik/bulgular
  // görünümünden açılan ilk pencere, çalışma alanına geçişte PeekLayer yeni bağlanırken kaybolmaz.
  useEffect(() => usePeek.getState().reset(review.id), [review.id]);

  return (
    <div className={`review${focusMode ? ' review--focus' : ''}`}>
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

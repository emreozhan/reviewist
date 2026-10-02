import { lazy, Suspense, useEffect, useRef } from 'react';
import { useShortcuts } from '../../hooks/useShortcuts';
import { storageKey } from '../../lib/persistence';
import type { RouteParams, Tab } from '../../lib/route';
import { parseHash, replaceHashSilently } from '../../lib/route';
import { orderedEntries } from '../../lib/selectors';
import { useProgress } from '../../state/progressStore';
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
  const applied = useRef(false);
  const selectedFileId = useUi((s) => s.selectedFileId);
  const selectedSymbolId = useUi((s) => s.selectedSymbolId);
  const centerView = useUi((s) => s.centerView);
  const diffLayout = useUi((s) => s.diffLayout);
  const helpOpen = useUi((s) => s.helpOpen);
  useShortcuts(tab);

  // İlk açılış: kalıcı durumu yükle, adresteki seçimi uygula ya da plandaki ilk dosyayı seç.
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    useProgress.getState().init(storageKey(review));
    const ui = useUi.getState();
    ui.resetForReview(review.id);
    if (params.layout) ui.setDiffLayout(params.layout);
    const file = params.file && index.fileById.has(params.file) ? params.file : undefined;
    if (file && params.line) ui.goToLine(file, params.line, params.sym);
    else if (file && params.sym) ui.selectSymbol(params.sym, file);
    else if (file) ui.selectFile(file);
    else if (!useUi.getState().selectedFileId) {
      const first = orderedEntries(review, index)[0];
      if (first) ui.selectFile(first.file.id);
    }
    if (file && params.view) useUi.getState().setCenterView(params.view);
  }, [review, index, params]);

  // Seçimi adres çubuğuna yansıt (paylaşılabilir bağlantı, yenilemede korunur).
  useEffect(() => {
    if (!applied.current) return;
    // Sekme adresten okunur: aynı anda yapılan sekme geçişini (navigate) eski prop ile ezmemek için.
    const current = parseHash(window.location.hash);
    if (current.name !== 'review' || current.id !== review.id) return;
    replaceHashSilently({
      name: 'review',
      id: review.id,
      tab: current.tab,
      params: {
        file: selectedFileId ?? undefined,
        sym: selectedSymbolId ?? undefined,
        view: centerView ?? undefined,
        layout: diffLayout === 'split' ? 'split' : undefined,
      },
    });
  }, [review.id, tab, selectedFileId, selectedSymbolId, centerView, diffLayout]);

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

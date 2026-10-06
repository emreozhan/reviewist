import { useEffect, useRef } from 'react';
import { activeTab } from '../../lib/tabs';
import { useTabs } from '../../state/tabsStore';
import { useUi } from '../../state/uiStore';
import { SourceTab } from '../codeview/SourceTab';
import { DiffView } from '../diff/DiffView';
import { PeekFromContext } from '../peek/PeekContext';
import { PeekLayer } from '../peek/PeekLayer';
import { StructureView } from '../structure/StructureView';
import { HistoryTrail } from '../tabs/HistoryTrail';
import { TabBar } from '../tabs/TabBar';
import { tabDomId } from '../tabs/TabItem';
import { FileHeader } from './FileHeader';
import { NoChanges } from './NoChanges';
import { useReviewCtx } from './ReviewContext';

/** Diff içindeki dosya: mevcut Yapı / Diff görünümleri. */
function DiffFilePanel({ fileId }: { fileId: string }) {
  const { index } = useReviewCtx();
  const centerView = useUi((s) => s.centerView);
  const scrollRef = useRef<HTMLDivElement>(null);
  const file = index.fileById.get(fileId);

  useEffect(() => {
    // Satıra gitme isteği varsa kaydırmayı diff tablosu yapar; burada başa sarmak onu ezer.
    const focus = useUi.getState().focusLine;
    if (focus && focus.fileId === fileId) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [fileId]);

  if (!file) return <p className="center__note">Dosya bu incelemede bulunamadı: {fileId}</p>;
  const hasStructure = file.language === 'java' && file.typeIds.length > 0 && !file.binary;
  const view = hasStructure ? (centerView ?? 'structure') : 'diff';

  return (
    <div className="center__file">
      <FileHeader file={file} view={view} hasStructure={hasStructure} />
      <div className="center__scroll" ref={scrollRef}>
        {file.binary ? (
          <p className="center__note">İkili (binary) dosya: içerik farkı gösterilemiyor.</p>
        ) : view === 'structure' ? (
          <StructureView key={file.id} file={file} />
        ) : (
          <DiffView key={file.id} file={file} />
        )}
      </div>
    </div>
  );
}

/**
 * Orta panel: sekme çubuğu + gezinme izi + etkin sekmenin içeriği (diff içi: Yapı/Diff, diff dışı: Kaynak).
 * Koddaki bağlantılar etkin sekmenin önünde gözatma pencereleri açar (PeekLayer); buradan açılan yeni zincir başlatır.
 */
export function CenterPanel() {
  const active = useTabs((s) => activeTab(s));
  const activeIndex = useTabs((s) => s.tabs.findIndex((t) => t.key === s.activeKey));
  const { review } = useReviewCtx();

  return (
    <div className="center">
      <TabBar />
      <HistoryTrail />
      <div className="center__panel" role="tabpanel" id="center-tabpanel" aria-labelledby={activeIndex >= 0 ? tabDomId(activeIndex) : undefined}>
        <PeekFromContext.Provider value="new">
        {review.files.length === 0 ? (
          <NoChanges source={review.source} />
        ) : !active ? (
          <div className="center-empty">
            <p className="center-empty__title">Bir dosya seçin</p>
            <p className="muted">
              Okuma planından başlayın ya da <kbd>j</kbd> / <kbd>k</kbd> ile gezinin. Koddaki bir referansa tıklamak onu önde bir gözatma penceresinde açar; <kbd>Shift</kbd>+tık sekmede açar.
            </p>
          </div>
        ) : active.inDiff ? (
          <DiffFilePanel fileId={active.path} />
        ) : (
          <SourceTab key={active.key} tab={active} />
        )}
        </PeekFromContext.Provider>
        <PeekLayer />
      </div>
    </div>
  );
}

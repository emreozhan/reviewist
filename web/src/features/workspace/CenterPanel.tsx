import { useEffect, useRef } from 'react';
import { useUi } from '../../state/uiStore';
import { DiffView } from '../diff/DiffView';
import { StructureView } from '../structure/StructureView';
import { FileHeader } from './FileHeader';
import { useReviewCtx } from './ReviewContext';

export function CenterPanel() {
  const { index } = useReviewCtx();
  const fileId = useUi((s) => s.selectedFileId);
  const centerView = useUi((s) => s.centerView);
  const scrollRef = useRef<HTMLDivElement>(null);
  const file = fileId ? index.fileById.get(fileId) : undefined;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [fileId]);

  if (!file) {
    return (
      <div className="center-empty">
        <p className="center-empty__title">Bir dosya seçin</p>
        <p className="muted">
          Okuma planından başlayın ya da <kbd>j</kbd> / <kbd>k</kbd> ile gezinin.
        </p>
      </div>
    );
  }

  const hasStructure = file.language === 'java' && file.typeIds.length > 0 && !file.binary;
  const view = hasStructure ? (centerView ?? 'structure') : 'diff';

  return (
    <div className="center">
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

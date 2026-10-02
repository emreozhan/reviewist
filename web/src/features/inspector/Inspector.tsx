import { Icon } from '../../components/Icon';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FileInspector } from './FileInspector';
import { SymbolInspector } from './SymbolInspector';

export function Inspector({ onCollapse }: { onCollapse: () => void }) {
  const { index } = useReviewCtx();
  const symbolId = useUi((s) => s.selectedSymbolId);
  const fileId = useUi((s) => s.selectedFileId);
  const selectSymbol = useUi((s) => s.selectSymbol);
  const file = fileId ? index.fileById.get(fileId) : undefined;

  return (
    <div className="insp">
      <div className="panel-head">
        <span className="panel-head__title">Denetçi</span>
        {symbolId && (
          <button type="button" className="link-btn" onClick={() => selectSymbol(null)}>
            dosyaya dön
          </button>
        )}
        <button type="button" className="icon-btn icon-btn--sm" onClick={onCollapse} aria-label="Denetçiyi daralt" title="Denetçiyi daralt">
          <Icon name="chevronRight" />
        </button>
      </div>
      <div className="insp__scroll">
        {symbolId ? (
          <SymbolInspector key={symbolId} symbolId={symbolId} />
        ) : file ? (
          <FileInspector key={file.id} file={file} />
        ) : (
          <p className="muted insp__empty">Bir dosya ya da sembol seçin.</p>
        )}
      </div>
    </div>
  );
}

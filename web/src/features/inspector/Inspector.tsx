import { PanelTools } from '../../components/PanelTools';
import { activeTab } from '../../lib/tabs';
import { useTabs } from '../../state/tabsStore';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FileInspector } from './FileInspector';
import { SourceInspector } from './SourceInspector';
import { SymbolInspector } from './SymbolInspector';

export function Inspector() {
  const { index } = useReviewCtx();
  const symbolId = useUi((s) => s.selectedSymbolId);
  const fileId = useUi((s) => s.selectedFileId);
  const selectSymbol = useUi((s) => s.selectSymbol);
  const outside = useTabs((s) => {
    const t = activeTab(s);
    return t && !t.inDiff ? t : undefined;
  });
  const file = fileId ? index.fileById.get(fileId) : undefined;

  return (
    <div className="insp">
      <div className="panel-head">
        <span className="panel-head__title">Denetçi</span>
        {symbolId && !outside && (
          <button type="button" className="link-btn" onClick={() => selectSymbol(null)}>
            dosyaya dön
          </button>
        )}
        <PanelTools panel="insp" />
      </div>
      <div className="insp__scroll">
        {outside ? (
          <SourceInspector key={`${outside.key}|${outside.symbolId ?? ''}`} tab={outside} />
        ) : symbolId ? (
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

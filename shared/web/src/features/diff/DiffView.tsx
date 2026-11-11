import { useCallback, useMemo, useState } from 'react';
import type { FileChange, TypeChange } from '../../../../src/shared/types';
import { useFileContent } from '../../hooks/queries';
import { useHighlighted } from '../../hooks/useHighlighted';
import { buildSymbolMap } from '../../lib/diffPresentation';
import { buildDiffRows } from '../../lib/diffRows';
import { langFor } from '../../lib/highlight';
import { useUi } from '../../state/uiStore';
import { useCodeRefs } from '../codenav/useCodeRefs';
import { useReviewCtx } from '../workspace/ReviewContext';
import { SplitTable } from './SplitTable';
import { UnifiedTable } from './UnifiedTable';

/** Tam dosya diff'i: birleşik/yan yana, sözdizimi renklendirme, üye sınırları, bağlam genişletme. */
export function DiffView({ file }: { file: FileChange }) {
  const { review, index } = useReviewCtx();
  const layout = useUi((s) => s.diffLayout);
  const selectedSymbolId = useUi((s) => s.selectedSymbolId);
  const selectSymbol = useUi((s) => s.selectSymbol);
  const focusLine = useUi((s) => s.focusLine);
  const clearFocus = useUi((s) => s.clearFocus);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [expandAll, setExpandAll] = useState(false);

  const newQ = useFileContent(review.id, file.status === 'deleted' ? undefined : file.path, 'new');
  const oldQ = useFileContent(review.id, file.status === 'added' ? undefined : (file.oldPath ?? file.path), 'old');
  const lang = langFor(file.language);
  // Koddan gezinme: yeni taraftaki referanslar (outline ucu yoksa kapalı).
  const refs = useCodeRefs(file.status === 'deleted' ? undefined : file.path, 'new', file.language === 'java' && !file.binary);
  const newHl = useHighlighted(newQ.content, lang);
  const oldHl = useHighlighted(oldQ.content, lang);

  const rows = useMemo(
    () => buildDiffRows(file.hunks, { newLines: newQ.lines ?? undefined, expandedGaps: expanded, expandAll }),
    [file.hunks, newQ.lines, expanded, expandAll],
  );
  const types = useMemo(
    () => file.typeIds.map((id) => index.typeById.get(id)).filter((t): t is TypeChange => !!t),
    [file.typeIds, index],
  );
  const oldMap = useMemo(() => buildSymbolMap(types, 'old'), [types]);
  const newMap = useMemo(() => buildSymbolMap(types, 'new'), [types]);

  // Satırlar tam içerikle yeniden kurulur: odak, içerik yüklenince (ya da alınamayınca) uygulanır.
  const contentSettled = file.status === 'deleted' || !newQ.isPending;
  const focus = contentSettled && focusLine && focusLine.fileId === file.id ? focusLine : null;
  // Odak satırı kapalı bağlamdaysa tüm dosyayı aç; satır görünür olunca tablo oraya kaydırır.
  const onFocusMissing = useCallback(() => setExpandAll(true), []);

  const contentMissing = file.status !== 'deleted' && newQ.isFetched && newQ.content === null;
  const hasGaps = rows.some((r) => r.kind === 'gap' && r.expandable);
  const props = {
    rows,
    lang,
    oldHl,
    newHl,
    oldMap: types.length > 0 ? oldMap : undefined,
    newMap: types.length > 0 ? newMap : undefined,
    selectedSymbolId,
    onSelectSymbol: (id: string) => selectSymbol(id, file.id),
    onExpand: (id: string) => setExpanded((s) => new Set([...s, id])),
    focus,
    onFocusMissing,
    onFocusDone: clearFocus,
    label: `${file.path} farkı`,
    refSpans: refs.spans,
  };

  return (
    <div className="diffview">
      <div className="diffview__bar">
        {file.hunks.length === 0 && <span className="muted">İçerik farkı yok (yalnızca yeniden adlandırma veya kip değişikliği).</span>}
        {contentMissing && <span className="muted">Tam dosya içeriği alınamadı; yalnız hunk'lar gösteriliyor.</span>}
        {newQ.isFetching && <span className="muted">İçerik yükleniyor…</span>}
        {refs.loading && <span className="muted">Kod bağlantıları yükleniyor…</span>}
        <span className="diffview__spacer" />
        {(hasGaps || expandAll) && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setExpandAll((v) => !v)} aria-pressed={expandAll}>
            {expandAll ? 'Yalnız değişiklikler' : 'Tüm dosyayı göster'}
          </button>
        )}
      </div>
      <div className={`code-surface${refs.spans ? ' has-refs' : ''}`} {...refs.handlers}>
        {layout === 'split' ? <SplitTable {...props} /> : <UnifiedTable {...props} />}
      </div>
      {refs.menu}
    </div>
  );
}

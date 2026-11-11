import { useMemo } from 'react';
import type { FileChange, MemberChange, TypeChange } from '../../../../src/shared/types';
import { useFileContent } from '../../hooks/queries';
import { useHighlighted } from '../../hooks/useHighlighted';
import { buildSymbolMap } from '../../lib/diffPresentation';
import { buildDiffRows } from '../../lib/diffRows';
import { langFor } from '../../lib/highlight';
import { findDeclarationLine } from '../../lib/locate';
import { useCodeRefs } from '../codenav/useCodeRefs';
import { SourceCode } from '../codeview/SourceCode';
import { UnifiedTable } from '../diff/UnifiedTable';
import { useMemberDiff } from '../structure/useMemberDiff';
import { useReviewCtx } from '../workspace/ReviewContext';

/** Pencere başına bağımsız odak: global `focusLine` kullanılmaz; satır değişince (ana hat gelince) yeniden kaydırılır. */
export interface PeekFocus {
  line: number;
  tick: number;
}

const languageOfPath = (path: string): FileChange['language'] => {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, FileChange['language']> = { java: 'java', kt: 'kotlin', xml: 'xml', yml: 'yaml', yaml: 'yaml', properties: 'properties', sql: 'sql', gradle: 'gradle', json: 'json', md: 'markdown' };
  return map[ext] ?? 'other';
};

function Note({ children }: { children: string }) {
  return <p className="peek__note">{children}</p>;
}

/** Diff dışı (ya da silinmiş sembolün eski) dosya: salt okunur, sözdizimi renkli, pencereli tam kaynak. */
export function PeekSource({ path, side, focus, range, symbolId }: { path: string; side: 'old' | 'new'; focus: PeekFocus | null; range?: { startLine: number; endLine: number }; symbolId: string }) {
  const { review } = useReviewCtx();
  const isJava = path.endsWith('.java');
  const q = useFileContent(review.id, path, side);
  const hl = useHighlighted(q.content, langFor(languageOfPath(path)));
  const refs = useCodeRefs(path, side, isJava);
  // Konum bilinmiyorsa (sunucu ana hat vermedi) bildirim metinden aranır.
  const searched = !focus && q.lines ? findDeclarationLine(q.lines, symbolId) : undefined;
  const at = useMemo(() => focus ?? (searched ? { line: searched, tick: searched } : null), [focus, searched]);
  if (q.isPending) return <Note>Kaynak yükleniyor…</Note>;
  if (q.isError) return <Note>{`Kaynak alınamadı: ${q.error.message}`}</Note>;
  if (!q.lines) return <Note>{`Dosya içeriği sunucudan alınamadı: ${path}`}</Note>;
  return (
    <>
      <SourceCode lines={q.lines} hl={hl} spans={refs.spans} focus={at} range={range} label={`${path} kaynağı (salt okunur)`} handlers={refs.handlers} />
      {refs.menu}
    </>
  );
}

/** Diff içindeki değişmiş üye: yalnız üyenin eski/yeni satırları (üye odaklı diff). */
export function PeekMemberDiff({ file, member, focus }: { file: FileChange; member: MemberChange; focus: PeekFocus | null }) {
  const d = useMemberDiff(file, member);
  const refs = useCodeRefs(member.newRange && file.status !== 'deleted' ? file.path : undefined, 'new', file.language === 'java');
  const hasLines = d.rows.some((r) => r.kind === 'line');
  if (!hasLines) return <Note>{d.loading ? 'Satırlar yükleniyor…' : 'Bu üyenin aralığında gösterilecek satır yok.'}</Note>;
  return (
    <>
      {d.partial && <Note>Tam dosya içeriği alınamadı; yalnız diff hunk'larına düşen satırlar gösteriliyor.</Note>}
      <div className={`code-surface peek__surface${refs.spans ? ' has-refs' : ''}`} {...refs.handlers}>
        <UnifiedTable rows={d.rows} lang={langFor(file.language)} oldHl={d.oldHl} newHl={d.newHl} label={`${member.name} üye farkı`} refSpans={refs.spans} focus={focus} />
      </div>
      {refs.menu}
    </>
  );
}

/** Diff içindeki dosyanın tamamı (tüm bağlam açık), üye sınırlarıyla; hedef satıra kaydırılır. */
export function PeekFileDiff({ file, focus }: { file: FileChange; focus: PeekFocus | null }) {
  const { review, index } = useReviewCtx();
  const newQ = useFileContent(review.id, file.status === 'deleted' ? undefined : file.path, 'new');
  const oldQ = useFileContent(review.id, file.status === 'added' ? undefined : (file.oldPath ?? file.path), 'old');
  const lang = langFor(file.language);
  const refs = useCodeRefs(file.status === 'deleted' ? undefined : file.path, 'new', file.language === 'java' && !file.binary);
  const newHl = useHighlighted(newQ.content, lang);
  const oldHl = useHighlighted(oldQ.content, lang);
  const rows = useMemo(() => buildDiffRows(file.hunks, { newLines: newQ.lines ?? undefined, expandAll: true }), [file.hunks, newQ.lines]);
  const types = useMemo(() => file.typeIds.map((id) => index.typeById.get(id)).filter((t): t is TypeChange => !!t), [file.typeIds, index]);
  const oldMap = useMemo(() => buildSymbolMap(types, 'old'), [types]);
  const newMap = useMemo(() => buildSymbolMap(types, 'new'), [types]);
  if (file.binary) return <Note>İkili (binary) dosya: içerik farkı gösterilemiyor.</Note>;
  const settled = file.status === 'deleted' || !newQ.isPending;
  return (
    <>
      {newQ.isFetched && newQ.content === null && file.status !== 'deleted' && <Note>Tam dosya içeriği alınamadı; yalnız hunk'lar gösteriliyor.</Note>}
      <div className={`code-surface peek__surface${refs.spans ? ' has-refs' : ''}`} {...refs.handlers}>
        <UnifiedTable
          rows={rows}
          lang={lang}
          oldHl={oldHl}
          newHl={newHl}
          oldMap={types.length > 0 ? oldMap : undefined}
          newMap={types.length > 0 ? newMap : undefined}
          label={`${file.path} farkı`}
          refSpans={refs.spans}
          focus={settled ? focus : null}
        />
      </div>
      {refs.menu}
    </>
  );
}

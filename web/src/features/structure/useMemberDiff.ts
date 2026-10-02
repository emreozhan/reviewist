import { useMemo } from 'react';
import type { FileChange, MemberChange } from '../../../../src/shared/types';
import { useFileContent } from '../../hooks/queries';
import { useHighlighted } from '../../hooks/useHighlighted';
import type { DiffRow } from '../../lib/diffRows';
import { buildDiffRows, sliceRowsByRange } from '../../lib/diffRows';
import { langFor } from '../../lib/highlight';
import { hunksFromLines } from '../../lib/hunks';
import { useReviewCtx } from '../workspace/ReviewContext';

export interface MemberDiffResult {
  rows: DiffRow[];
  /** 'moved': başka dosyadaki eski konumla karşılaştırma. */
  mode: 'file' | 'moved';
  partial: boolean;
  loading: boolean;
  oldHl: string[] | null;
  newHl: string[] | null;
  counterpartFile?: string;
}

/**
 * Üye odaklı diff: dosya hunk'larından üyenin eski/yeni aralığına düşen satırlar.
 * Tam içerik alınabilirse aralık bağlamla doldurulur; başka dosyadan taşınan üyede eski konumla karşılaştırılır.
 */
export function useMemberDiff(file: FileChange, member: MemberChange): MemberDiffResult {
  const { review, index } = useReviewCtx();
  const lang = langFor(file.language);

  const counterpart = member.oldId ? index.memberById.get(member.oldId) : undefined;
  const cpFilePath = counterpart?.oldRange ? index.symbolFile.get(counterpart.id) : undefined;
  const crossFile = !!counterpart?.oldRange && !!member.newRange && !!cpFilePath && cpFilePath !== file.path;
  const cpFile = cpFilePath ? index.fileById.get(cpFilePath) : undefined;

  const newQ = useFileContent(review.id, member.newRange && file.status !== 'deleted' ? file.path : undefined, 'new');
  const oldPath = crossFile ? (cpFile?.oldPath ?? cpFilePath) : member.oldRange && file.status !== 'added' ? (file.oldPath ?? file.path) : undefined;
  const oldQ = useFileContent(review.id, oldPath, 'old');
  const newHl = useHighlighted(newQ.content, lang);
  const oldHl = useHighlighted(oldQ.content, lang);

  const result = useMemo(() => {
    if (crossFile && counterpart?.oldRange && member.newRange && oldQ.lines && newQ.lines) {
      const o = counterpart.oldRange;
      const n = member.newRange;
      const hunks = hunksFromLines(oldQ.lines.slice(o.startLine - 1, o.endLine), newQ.lines.slice(n.startLine - 1, n.endLine), 10_000);
      const lines = hunks.flatMap((h) => h.lines).map((l) => ({
        ...l,
        oldNo: l.oldNo !== undefined ? l.oldNo + o.startLine - 1 : undefined,
        newNo: l.newNo !== undefined ? l.newNo + n.startLine - 1 : undefined,
      }));
      const rows: DiffRow[] = lines.length > 0
        ? lines.map((line) => ({ kind: 'line' as const, line }))
        : newQ.lines.slice(n.startLine - 1, n.endLine).map((text, k) => ({ kind: 'line' as const, line: { type: 'context' as const, oldNo: o.startLine + k, newNo: n.startLine + k, text } }));
      return { rows, partial: false, mode: 'moved' as const };
    }
    const rows = buildDiffRows(file.hunks, { newLines: newQ.lines ?? undefined, expandAll: true });
    const slice = sliceRowsByRange(rows, member.oldRange, member.newRange);
    return { rows: slice.rows, partial: slice.partial, mode: 'file' as const };
  }, [crossFile, counterpart, member.newRange, member.oldRange, oldQ.lines, newQ.lines, file.hunks]);

  return {
    ...result,
    loading: newQ.isFetching || oldQ.isFetching,
    oldHl,
    newHl,
    counterpartFile: crossFile ? cpFilePath : undefined,
  };
}

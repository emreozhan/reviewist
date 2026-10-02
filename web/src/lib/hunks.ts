import type { DiffHunk, DiffLine } from '../../../src/shared/types';
import { diffSequences, splitLines } from './lcs';

/**
 * İki metinden birleşik diff hunk'ları üretir (mock veri ve taşınan üye karşılaştırması için).
 * `context` kadar bağlam satırı eklenir; yakın değişiklikler tek hunk'ta birleşir.
 */
export function buildHunks(oldText: string, newText: string, context = 3): DiffHunk[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  return hunksFromLines(a, b, context);
}

export function hunksFromLines(a: readonly string[], b: readonly string[], context = 3): DiffHunk[] {
  const ops = diffSequences(a, b);
  const lines: DiffLine[] = ops.map((op) => {
    if (op.type === 'eq') return { type: 'context', oldNo: op.a + 1, newNo: op.b + 1, text: b[op.b] ?? '' };
    if (op.type === 'del') return { type: 'del', oldNo: op.a + 1, text: a[op.a] ?? '' };
    return { type: 'add', newNo: op.b + 1, text: b[op.b] ?? '' };
  });

  const ranges: Array<[number, number]> = [];
  lines.forEach((line, idx) => {
    if (line.type === 'context') return;
    const start = Math.max(0, idx - context);
    const end = Math.min(lines.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  });

  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    let oldBefore = 0;
    let newBefore = 0;
    for (let i = 0; i < start; i++) {
      const l = lines[i];
      if (!l) continue;
      if (l.type !== 'add') oldBefore++;
      if (l.type !== 'del') newBefore++;
    }
    const oldLines = slice.filter((l) => l.type !== 'add').length;
    const newLines = slice.filter((l) => l.type !== 'del').length;
    return {
      oldStart: oldLines === 0 ? oldBefore : oldBefore + 1,
      oldLines,
      newStart: newLines === 0 ? newBefore : newBefore + 1,
      newLines,
      header: '',
      lines: slice,
    };
  });
}

export function countChanges(hunks: readonly DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.type === 'add') additions++;
      else if (l.type === 'del') deletions++;
    }
  }
  return { additions, deletions };
}

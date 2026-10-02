import type { DiffLine } from '../../../src/shared/types';
import type { SplitRow, SymbolMark } from './diffPresentation';
import { markFor } from './diffPresentation';
import type { DiffRow, GapRow } from './diffRows';

/**
 * Diff tablolarının düz öğe listesi: her öğe tam olarak bir `<tr>`'dir (pencerelemede ölçülebilsin diye).
 * Üye sınırı satırları ayrı öğe olarak araya eklenir.
 */
export type UnifiedItem =
  | { kind: 'gap'; key: string; gap: GapRow }
  | { kind: 'boundary'; key: string; mark: SymbolMark }
  | { kind: 'line'; key: string; line: DiffLine; rowIndex: number; mark?: SymbolMark };

export type SplitPair = Extract<SplitRow, { kind: 'pair' }>;

export type SplitItem =
  | { kind: 'gap'; key: string; gap: GapRow }
  | { kind: 'boundary'; key: string; mark: SymbolMark }
  | { kind: 'pair'; key: string; row: SplitPair; mark?: SymbolMark };

interface Maps {
  oldMap?: Map<number, SymbolMark>;
  newMap?: Map<number, SymbolMark>;
}

function lineKey(line: DiffLine): string {
  return `${line.type}-${line.oldNo ?? ''}-${line.newNo ?? ''}`;
}

export function unifiedItems(rows: readonly DiffRow[], { oldMap, newMap }: Maps): UnifiedItem[] {
  const out: UnifiedItem[] = [];
  let prevMark: string | undefined;
  rows.forEach((row, rowIndex) => {
    if (row.kind === 'gap') {
      prevMark = undefined;
      out.push({ kind: 'gap', key: `gap-${row.id}`, gap: row });
      return;
    }
    const mark = oldMap && newMap ? markFor(row.line, oldMap, newMap) : undefined;
    const key = lineKey(row.line);
    if (mark && mark.id !== prevMark) out.push({ kind: 'boundary', key: `b-${key}`, mark });
    prevMark = mark?.id;
    out.push({ kind: 'line', key, line: row.line, rowIndex, mark });
  });
  return out;
}

export function splitItems(rows: readonly SplitRow[], { oldMap, newMap }: Maps): SplitItem[] {
  const out: SplitItem[] = [];
  let prevMark: string | undefined;
  for (const row of rows) {
    if (row.kind === 'gap') {
      prevMark = undefined;
      out.push({ kind: 'gap', key: `gap-${row.id}`, gap: row });
      continue;
    }
    const ref = row.right?.line ?? row.left?.line;
    const mark = ref && oldMap && newMap ? markFor(ref, oldMap, newMap) : undefined;
    const key = `p-${row.left?.line.oldNo ?? ''}-${row.right?.line.newNo ?? ''}`;
    if (mark && mark.id !== prevMark) out.push({ kind: 'boundary', key: `b-${key}`, mark });
    prevMark = mark?.id;
    out.push({ kind: 'pair', key, row, mark });
  }
  return out;
}

/** Yeni taraftaki `line` numarasını gösteren öğenin indeksi; yoksa -1. */
export function indexOfNewLine(items: readonly (UnifiedItem | SplitItem)[], line: number): number {
  return items.findIndex((it) => {
    if (it.kind === 'line') return it.line.type !== 'del' && it.line.newNo === line;
    if (it.kind === 'pair') return it.row.right?.line.newNo === line;
    return false;
  });
}

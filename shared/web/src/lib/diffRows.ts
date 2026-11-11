import type { DiffHunk, DiffLine, Range } from '../../../src/shared/types';

export interface LineRow {
  kind: 'line';
  line: DiffLine;
}

/** Gösterilmeyen değişmemiş satırlar. `count` null ise uzunluk bilinmiyor (içerik yok). */
export interface GapRow {
  kind: 'gap';
  id: string;
  oldStart: number;
  newStart: number;
  count: number | null;
  expandable: boolean;
}

export type DiffRow = LineRow | GapRow;

export interface BuildRowsOptions {
  /** Yeni taraftaki dosyanın tam satırları (varsa boşluklar doldurulabilir). */
  newLines?: readonly string[];
  expandedGaps?: ReadonlySet<string>;
  expandAll?: boolean;
}

function lastNumbers(h: DiffHunk): { oldEnd: number; newEnd: number } {
  return {
    oldEnd: h.oldLines === 0 ? h.oldStart : h.oldStart + h.oldLines - 1,
    newEnd: h.newLines === 0 ? h.newStart : h.newStart + h.newLines - 1,
  };
}

/** Hunk'ları satır listesine çevirir; hunk aralarındaki boşlukları gap satırı (veya açılmışsa bağlam) olarak ekler. */
export function buildDiffRows(hunks: readonly DiffHunk[], opts: BuildRowsOptions = {}): DiffRow[] {
  const rows: DiffRow[] = [];
  const { newLines, expandedGaps, expandAll } = opts;
  let prevOld = 0;
  let prevNew = 0;

  const pushGap = (oldStart: number, newStart: number, count: number | null) => {
    if (count !== null && count <= 0) return;
    const id = `g${newStart}`;
    const canExpand = !!newLines && count !== null;
    if (canExpand && (expandAll || expandedGaps?.has(id))) {
      for (let k = 0; k < (count ?? 0); k++) {
        rows.push({
          kind: 'line',
          line: { type: 'context', oldNo: oldStart + k, newNo: newStart + k, text: newLines[newStart + k - 1] ?? '' },
        });
      }
      return;
    }
    rows.push({ kind: 'gap', id, oldStart, newStart, count, expandable: canExpand });
  };

  for (const h of hunks) {
    const firstNew = h.newLines === 0 ? h.newStart + 1 : h.newStart;
    pushGap(prevOld + 1, prevNew + 1, firstNew - (prevNew + 1));
    for (const line of h.lines) rows.push({ kind: 'line', line });
    const { oldEnd, newEnd } = lastNumbers(h);
    prevOld = oldEnd;
    prevNew = newEnd;
  }
  // İçerik bilinmiyorsa dosyanın geri kalanının uzunluğu da bilinmez; sona boşluk eklenmez.
  if (newLines) pushGap(prevOld + 1, prevNew + 1, newLines.length - prevNew);
  return rows;
}

function inRange(n: number | undefined, r: Range | undefined): boolean {
  return n !== undefined && r !== undefined && n >= r.startLine && n <= r.endLine;
}

export function lineInRanges(line: DiffLine, oldRange?: Range, newRange?: Range): boolean {
  if (line.type === 'del') return inRange(line.oldNo, oldRange);
  if (line.type === 'add') return inRange(line.newNo, newRange);
  // Bağlam satırında yeni taraf belirleyicidir; LCS hizalaması eski kapanış parantezini başka üyeye eşleyebilir.
  return newRange ? inRange(line.newNo, newRange) : inRange(line.oldNo, oldRange);
}

export interface MemberSlice {
  rows: DiffRow[];
  /** Aralığın bir kısmı açılmamış boşluğa düştüyse true (tam içerik yok). */
  partial: boolean;
  changed: boolean;
}

/**
 * Üye odaklı diff: satırlardan yalnız üyenin eski/yeni aralığına düşenleri seçer.
 * Ardışık olmayan satırlar arasına sayısı bilinen, açılamaz gap konur.
 */
export function sliceRowsByRange(rows: readonly DiffRow[], oldRange?: Range, newRange?: Range): MemberSlice {
  const out: DiffRow[] = [];
  let partial = false;
  let changed = false;
  let prev: DiffLine | undefined;
  for (const row of rows) {
    if (row.kind === 'gap') {
      const gapNewEnd = row.count === null ? Number.POSITIVE_INFINITY : row.newStart + row.count - 1;
      const gapOldEnd = row.count === null ? Number.POSITIVE_INFINITY : row.oldStart + row.count - 1;
      const overlapsNew = newRange && row.newStart <= newRange.endLine && gapNewEnd >= newRange.startLine;
      const overlapsOld = oldRange && row.oldStart <= oldRange.endLine && gapOldEnd >= oldRange.startLine;
      if (overlapsNew || overlapsOld) partial = true;
      continue;
    }
    const line = row.line;
    if (!lineInRanges(line, oldRange, newRange)) continue;
    if (prev) {
      const jumpNew = line.newNo !== undefined && prev.newNo !== undefined && line.newNo - prev.newNo > 1;
      const jumpOld = line.oldNo !== undefined && prev.oldNo !== undefined && line.oldNo - prev.oldNo > 1;
      if (jumpNew || jumpOld) {
        const count = jumpNew ? (line.newNo ?? 0) - (prev.newNo ?? 0) - 1 : (line.oldNo ?? 0) - (prev.oldNo ?? 0) - 1;
        out.push({
          kind: 'gap',
          id: `s${line.newNo ?? line.oldNo ?? 0}`,
          oldStart: (prev.oldNo ?? 0) + 1,
          newStart: (prev.newNo ?? 0) + 1,
          count,
          expandable: false,
        });
      }
    }
    if (line.type !== 'context') changed = true;
    out.push(row);
    prev = line;
  }
  return { rows: out, partial, changed };
}

/** Yeni taraftaki satır numarasının eski taraftaki karşılığı (yalnız bağlam satırları için anlamlı). */
export function findRowIndexByLine(rows: readonly DiffRow[], line: number, side: 'old' | 'new'): number {
  return rows.findIndex(
    (r) => r.kind === 'line' && (side === 'new' ? r.line.newNo === line && r.line.type !== 'del' : r.line.oldNo === line),
  );
}

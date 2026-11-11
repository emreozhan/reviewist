import type { ChangeStatus, DiffLine, TypeChange } from '../../../src/shared/types';
import type { DiffRow, GapRow } from './diffRows';
import type { Segment } from './wordDiff';
import { MIN_SIMILARITY, wordDiff } from './wordDiff';

/** Birleşik görünüm için satır indeksine göre kelime düzeyi vurgu (gap satırları blokları böler). */
export function wordSegmentsForRows(rows: readonly DiffRow[]): Map<number, Segment[]> {
  const out = new Map<number, Segment[]>();
  let i = 0;
  const isType = (idx: number, t: DiffLine['type']) => {
    const r = rows[idx];
    return r?.kind === 'line' && r.line.type === t;
  };
  while (i < rows.length) {
    if (!isType(i, 'del')) {
      i++;
      continue;
    }
    const delStart = i;
    while (isType(i, 'del')) i++;
    const addStart = i;
    while (isType(i, 'add')) i++;
    const pairs = Math.min(addStart - delStart, i - addStart);
    for (let k = 0; k < pairs; k++) {
      const d = rows[delStart + k];
      const a = rows[addStart + k];
      if (d?.kind !== 'line' || a?.kind !== 'line') continue;
      const wd = wordDiff(d.line.text, a.line.text);
      if (wd.similarity < MIN_SIMILARITY) continue;
      out.set(delStart + k, wd.old);
      out.set(addStart + k, wd.new);
    }
  }
  return out;
}

export interface SplitSide {
  line: DiffLine;
  segments?: Segment[];
}

export type SplitRow = { kind: 'pair'; left?: SplitSide; right?: SplitSide } | GapRow;

/** Yan yana görünüm: bağlam iki tarafta, silme bloğu ekleme bloğuyla sıra sıra eşlenir. */
export function toSplitRows(rows: readonly DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!row) break;
    if (row.kind === 'gap') {
      out.push(row);
      i++;
      continue;
    }
    if (row.line.type === 'context') {
      out.push({ kind: 'pair', left: { line: row.line }, right: { line: row.line } });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (rows[i]?.kind === 'line' && (rows[i] as { line: DiffLine }).line.type === 'del') {
      dels.push((rows[i] as { line: DiffLine }).line);
      i++;
    }
    while (rows[i]?.kind === 'line' && (rows[i] as { line: DiffLine }).line.type === 'add') {
      adds.push((rows[i] as { line: DiffLine }).line);
      i++;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const d = dels[k];
      const a = adds[k];
      let left: SplitSide | undefined = d ? { line: d } : undefined;
      let right: SplitSide | undefined = a ? { line: a } : undefined;
      if (d && a) {
        const wd = wordDiff(d.text, a.text);
        if (wd.similarity >= MIN_SIMILARITY) {
          left = { line: d, segments: wd.old };
          right = { line: a, segments: wd.new };
        }
      }
      out.push({ kind: 'pair', left, right });
    }
  }
  return out;
}

export interface SymbolMark {
  id: string;
  name: string;
  status: ChangeStatus;
  isStart: boolean;
}

/** Satır numarası → o satırın ait olduğu üye (eski veya yeni taraf). Sembol sınırı işaretleri için. */
export function buildSymbolMap(types: readonly TypeChange[], side: 'old' | 'new'): Map<number, SymbolMark> {
  const map = new Map<number, SymbolMark>();
  for (const t of types) {
    for (const m of t.members) {
      const r = side === 'old' ? m.oldRange : m.newRange;
      // Değişmeyen üyeler sınır işareti almaz: gürültüyü azaltır, dikkat değişene kalır.
      if (!r || m.status === 'unchanged') continue;
      const name = m.kind === 'field' ? m.name : `${m.name}()`;
      for (let n = r.startLine; n <= r.endLine; n++) {
        map.set(n, { id: m.id, name, status: m.status, isStart: n === r.startLine });
      }
    }
  }
  return map;
}

/** Satırın dosya bağlamıyla renklendirilmiş HTML'ini doğru taraftan seçer. */
export function lineHtml(line: DiffLine, oldHl: readonly string[] | null, newHl: readonly string[] | null): string | undefined {
  if (line.type === 'del') return line.oldNo !== undefined ? oldHl?.[line.oldNo - 1] : undefined;
  return line.newNo !== undefined ? newHl?.[line.newNo - 1] : undefined;
}

/** Bir satırın sembol işareti: silinen satırda eski, diğerlerinde yeni tarafa bakılır. */
export function markFor(line: DiffLine, oldMap: Map<number, SymbolMark>, newMap: Map<number, SymbolMark>): SymbolMark | undefined {
  if (line.type === 'del') return line.oldNo !== undefined ? oldMap.get(line.oldNo) : undefined;
  return (line.newNo !== undefined ? newMap.get(line.newNo) : undefined) ?? (line.oldNo !== undefined ? oldMap.get(line.oldNo) : undefined);
}

import type { DiffLine } from '../../../src/shared/types';
import { diffSequences } from './lcs';

export interface Segment {
  text: string;
  changed: boolean;
}

export interface WordDiffResult {
  old: Segment[];
  new: Segment[];
  /** 0..1 arası; boşluk dışı ortak karakter oranı. */
  similarity: number;
}

const TOKEN_RE = /\s+|[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function pushSeg(list: Segment[], text: string, changed: boolean): void {
  const last = list[list.length - 1];
  if (last && last.changed === changed) last.text += text;
  else list.push({ text, changed });
}

/** İki satır arasında kelime düzeyinde fark. */
export function wordDiff(oldLine: string, newLine: string): WordDiffResult {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const ops = diffSequences(a, b);
  const oldSegs: Segment[] = [];
  const newSegs: Segment[] = [];
  let common = 0;
  for (const op of ops) {
    if (op.type === 'eq') {
      const t = b[op.b] ?? '';
      pushSeg(oldSegs, t, false);
      pushSeg(newSegs, t, false);
      common += t.replace(/\s/g, '').length;
    } else if (op.type === 'del') {
      pushSeg(oldSegs, a[op.a] ?? '', true);
    } else {
      pushSeg(newSegs, b[op.b] ?? '', true);
    }
  }
  // Yalnız boşluktan oluşan değişen parçaları değişmemiş say (gürültüyü azaltır).
  for (const list of [oldSegs, newSegs]) {
    for (const s of list) if (s.changed && s.text.trim() === '') s.changed = false;
  }
  const total = oldLine.replace(/\s/g, '').length + newLine.replace(/\s/g, '').length;
  return { old: merge(oldSegs), new: merge(newSegs), similarity: total === 0 ? 1 : (2 * common) / total };
}

function merge(list: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of list) pushSeg(out, s.text, s.changed);
  return out;
}

/** Bu benzerliğin altındaki satır çiftlerinde satır içi vurgu yapılmaz (tamamen farklı satırlar). */
export const MIN_SIMILARITY = 0.35;

/**
 * Ardışık silme bloğunu takip eden ekleme bloğuyla sıra sıra eşler.
 * Dönüş: satır indeksi → vurgulu parçalar.
 */
export function pairWordDiffs(lines: readonly DiffLine[]): Map<number, Segment[]> {
  const result = new Map<number, Segment[]>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.type !== 'del') {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i]?.type === 'del') i++;
    const addStart = i;
    while (i < lines.length && lines[i]?.type === 'add') i++;
    const pairs = Math.min(addStart - delStart, i - addStart);
    for (let k = 0; k < pairs; k++) {
      const d = lines[delStart + k];
      const a = lines[addStart + k];
      if (!d || !a) continue;
      const wd = wordDiff(d.text, a.text);
      if (wd.similarity < MIN_SIMILARITY) continue;
      result.set(delStart + k, wd.old);
      result.set(addStart + k, wd.new);
    }
  }
  return result;
}

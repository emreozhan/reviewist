/**
 * Bellek içi ChangeSet: testlerde ve örneklerde git'e ihtiyaç duymadan değişiklik kümesi kurmak için.
 * Hunk'lar `diff` paketinin structuredPatch'i ile (3 satır bağlam) üretilir.
 */
import { structuredPatch } from 'diff';
import type { ChangeSet, ChangeSetFile, DiffHunk, DiffLine, FileStatus, ReviewSourceInfo } from '../../shared/types.js';

export interface MemoryChangeSetInput {
  /** Taban (eski) taraftaki değişen dosyalar: yol → içerik. */
  old: Record<string, string>;
  /** Head (yeni) taraftaki değişen dosyalar: yol → içerik. */
  new: Record<string, string>;
  /** Yeniden adlandırmalar: yeni yol → eski yol. */
  renames?: Record<string, string>;
  /** Head'de bulunan ama değişmemiş dosyalar (repo indeksi ve listFiles için). Her iki tarafta da okunabilir. */
  extraNewFiles?: Record<string, string>;
  info?: Partial<ReviewSourceInfo>;
}

/** İki metin arasındaki hunk'ları sözleşmedeki DiffHunk biçiminde üretir. */
export function computeHunks(oldPath: string, newPath: string, oldText: string, newText: string, context = 3): DiffHunk[] {
  const patch = structuredPatch(oldPath, newPath, oldText, newText, undefined, undefined, { context });
  return patch.hunks.map((h) => {
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    const lines: DiffLine[] = [];
    for (const raw of h.lines) {
      const sign = raw[0];
      const text = raw.slice(1);
      if (sign === '\\') continue; // "\ No newline at end of file"
      if (sign === '+') lines.push({ type: 'add', newNo: newNo++, text });
      else if (sign === '-') lines.push({ type: 'del', oldNo: oldNo++, text });
      else lines.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text });
    }
    return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, header: '', lines };
  });
}

function countLines(hunks: DiffHunk[], type: 'add' | 'del'): number {
  let n = 0;
  for (const h of hunks) for (const l of h.lines) if (l.type === type) n++;
  return n;
}

function makeFile(path: string, status: FileStatus, oldPath: string | undefined, oldText: string, newText: string): ChangeSetFile {
  const hunks = computeHunks(oldPath ?? path, path, oldText, newText);
  const file: ChangeSetFile = {
    path,
    status,
    binary: false,
    additions: countLines(hunks, 'add'),
    deletions: countLines(hunks, 'del'),
    hunks,
  };
  if (oldPath !== undefined) file.oldPath = oldPath;
  return file;
}

/**
 * Bellek içi ChangeSet üretir.
 *  - `new`'de olup `old`'da olmayan → added; `old`'da olup `new`'de olmayan (ve rename kaynağı değil) → deleted;
 *    ikisinde de olup içerik farklı → modified (aynıysa diff'e girmez, yalnızca okunabilir/listelenir);
 *    `renames` ile eşlenen → renamed.
 *  - readFile: eski taraf = old + extraNewFiles (+ değişmemiş ortaklar), yeni taraf = new + extraNewFiles.
 *  - listFiles('new'): head'deki tüm yollar, sıralı.
 */
export function createMemoryChangeSet(input: MemoryChangeSetInput): ChangeSet {
  const renames = input.renames ?? {};
  const extra = input.extraNewFiles ?? {};
  const renameSources = new Set(Object.values(renames));
  const files: ChangeSetFile[] = [];

  for (const [path, newText] of Object.entries(input.new)) {
    const renamedFrom = renames[path];
    if (renamedFrom !== undefined) {
      files.push(makeFile(path, 'renamed', renamedFrom, input.old[renamedFrom] ?? '', newText));
    } else if (path in input.old) {
      if (input.old[path] !== newText) files.push(makeFile(path, 'modified', undefined, input.old[path], newText));
    } else {
      files.push(makeFile(path, 'added', undefined, '', newText));
    }
  }
  for (const [path, oldText] of Object.entries(input.old)) {
    if (path in input.new || renameSources.has(path)) continue;
    files.push(makeFile(path, 'deleted', undefined, oldText, ''));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const oldSide = new Map<string, string>();
  const newSide = new Map<string, string>();
  for (const [p, t] of Object.entries(extra)) {
    oldSide.set(p, t);
    newSide.set(p, t);
  }
  for (const [p, t] of Object.entries(input.old)) oldSide.set(p, t);
  for (const [p, t] of Object.entries(input.new)) newSide.set(p, t);
  for (const p of renameSources) if (!(p in input.new)) newSide.delete(p);
  for (const f of files) if (f.status === 'deleted') newSide.delete(f.path);

  const info: ReviewSourceInfo = {
    kind: 'git',
    title: 'bellek içi değişiklik',
    baseRef: 'base',
    headRef: 'head',
    ...input.info,
  };

  return {
    info,
    files,
    async readFile(side, path) {
      return (side === 'old' ? oldSide : newSide).get(path);
    },
    async listFiles(_side, ext) {
      const all = [...newSide.keys()].sort();
      return ext ? all.filter((p) => p.endsWith(ext)) : all;
    },
  };
}

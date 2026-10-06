/**
 * Yapıştırılan unified diff / `git format-patch` metninden ChangeSet.
 * - Eklenen dosyanın yeni içeriği ve silinen dosyanın eski içeriği hunk'lardan kurulur (tam içerik oldukları için;
 *   repoPath gerekmez).
 * - Değişen dosyalarda repoPath verilirse içerik diskten türetilir: klasör yamanın uygulanmış hâliyse eski taraf yama
 *   geri alınarak, uygulanmamış hâliyse yeni taraf yama uygulanarak üretilir.
 * - repoPath bir git deposuysa diff dışındaki dosyalar da (çağıran/alt sınıf indeksi için) okunur.
 */
import { resolve } from 'node:path';
import { applyPatch, reversePatch, type StructuredPatch } from 'diff';
import {
  createSideResolver,
  filterByExt,
  isBinaryContent,
  isOsJunkFile,
  patchStableKey,
  readRepoFile,
  sanitizeRepoRelPath,
  type ManagedChangeSet,
} from './common.js';
import { runGit } from './git.js';
import { parseUnifiedDiffDetailed, type ParsedDiffFile } from './unifiedDiff.js';

export interface PatchChangeSetOptions {
  text: string;
  repoPath?: string;
  onProgress?: (msg: string) => void;
}

/** `Subject: [PATCH 1/2] Başlık` satırından başlık çıkarır. */
function patchTitle(text: string, fileCount: number): string {
  const m = /^Subject:\s*(?:\[[^\]]*\]\s*)?(.+)$/m.exec(text.slice(0, 4000));
  const subject = m?.[1]?.trim();
  if (subject) return subject;
  return `Yama (${fileCount} dosya)`;
}

function toStructuredPatch(p: ParsedDiffFile): StructuredPatch {
  const oldName = p.file.oldPath ?? p.file.path;
  return {
    oldFileName: `a/${oldName}`,
    newFileName: `b/${p.file.path}`,
    oldHeader: undefined,
    newHeader: undefined,
    hunks: p.rawHunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines: [...h.lines],
    })),
  };
}

/** Yeni içerikten yamayı geri alarak eski içeriği üretir; uygulanamazsa undefined. */
export function deriveOldContent(newContent: string, parsed: ParsedDiffFile): string | undefined {
  if (parsed.rawHunks.length === 0) return newContent; // yalnız mod/yeniden adlandırma
  try {
    const reversed = reversePatch(toStructuredPatch(parsed));
    const result = applyPatch(newContent, reversed);
    return result === false ? undefined : result;
  } catch {
    return undefined;
  }
}

/**
 * Tek hunk'lı tam dosya yamasından (silme: yalnız '-', ekleme: yalnız '+') içeriği kurar; `\ No newline` dikkate alınır.
 * Hunk sayısı/başlangıcı ya da satır sayısı başlıkla uyuşmazsa (kesilmiş/bozuk yama) undefined.
 */
function contentFromWholeFileHunk(parsed: ParsedDiffFile, sign: '-' | '+'): string | undefined {
  const all = parsed.rawHunks;
  if (all.length === 0) return '';
  const hunk = all[0];
  if (all.length !== 1 || !hunk) return undefined;
  const start = sign === '-' ? hunk.oldStart : hunk.newStart;
  const count = sign === '-' ? hunk.oldLines : hunk.newLines;
  const otherCount = sign === '-' ? hunk.newLines : hunk.oldLines;
  if (start > 1 || otherCount !== 0) return undefined;
  const lines = hunk.lines;
  let out = '';
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (l.startsWith('\\')) continue;
    if (!l.startsWith(sign)) return undefined;
    n++;
    out += l.slice(1);
    if (!(lines[i + 1] ?? '').startsWith('\\')) out += '\n';
  }
  return n === count ? out : undefined;
}

/** Silme yamasından dosyanın tam eski içeriğini kurar. */
export function contentFromDeletion(parsed: ParsedDiffFile): string | undefined {
  return contentFromWholeFileHunk(parsed, '-');
}

/** Ekleme yamasından dosyanın tam yeni içeriğini kurar. */
export function contentFromAddition(parsed: ParsedDiffFile): string | undefined {
  return contentFromWholeFileHunk(parsed, '+');
}

/** Eski içeriğe yamayı uygulayarak yeni içeriği üretir; uygulanamazsa undefined. */
export function deriveNewContent(oldContent: string, parsed: ParsedDiffFile): string | undefined {
  if (parsed.rawHunks.length === 0) return oldContent; // yalnız mod/yeniden adlandırma
  try {
    const result = applyPatch(oldContent, toStructuredPatch(parsed));
    return result === false ? undefined : result;
  } catch {
    return undefined;
  }
}

interface SideContents {
  old?: string;
  new?: string;
}

export async function createPatchChangeSet(opts: PatchChangeSetOptions): Promise<ManagedChangeSet> {
  opts.onProgress?.('Yama ayrıştırılıyor');
  const parsed = parseUnifiedDiffDetailed(opts.text);
  const files = parsed.map((p) => p.file);
  opts.onProgress?.(`Yama ayrıştırıldı: ${files.length} dosya`);
  const byPath = new Map(parsed.map((p) => [p.file.path, p]));
  const byOldPath = new Map<string, ParsedDiffFile>();
  for (const p of parsed) if (p.file.oldPath !== undefined) byOldPath.set(p.file.oldPath, p);
  const root = opts.repoPath !== undefined ? resolve(opts.repoPath) : undefined;
  const sideOf = createSideResolver(files);
  const warnings: string[] = [];
  if (files.length === 0) warnings.push('Yama metninde dosya değişikliği bulunamadı.');

  /** Depo içindeki bir metin dosyası (yol depo dışına çıkamaz; sembolik bağlar izlenmez). */
  const disk = async (path: string): Promise<string | undefined> => {
    if (root === undefined) return undefined;
    const buf = await readRepoFile(root, path);
    return !buf || isBinaryContent(buf, path) ? undefined : buf.toString('utf8');
  };

  let warnedUnapplied = false;
  const resolved = new Map<string, Promise<SideContents>>();
  /**
   * Yamadaki bir dosyanın eski/yeni içeriği. Depo klasörü yamanın uygulanmış hâli de olabilir, uygulanmamış hâli de:
   * önce disk = yeni varsayılıp yama geri alınır; tutmazsa disk = eski varsayılıp yama uygulanır.
   */
  const contentsOf = (entry: ParsedDiffFile): Promise<SideContents> => {
    const key = entry.file.path;
    let p = resolved.get(key);
    if (!p) {
      p = (async (): Promise<SideContents> => {
        const { path, oldPath, status, binary } = entry.file;
        if (binary) return {};
        // Eklenen/silinen dosyanın tüm satırları yamada bulunur; disk gerekmez.
        if (status === 'added') return { new: contentFromAddition(entry) ?? (await disk(path)) };
        if (status === 'deleted') return { old: contentFromDeletion(entry) ?? (await disk(oldPath ?? path)) };
        const atNew = await disk(path);
        if (atNew !== undefined) {
          const old = deriveOldContent(atNew, entry);
          if (old !== undefined) return { old, new: atNew };
        }
        const from = oldPath ?? path;
        const atOld = from === path ? atNew : await disk(from);
        if (atOld !== undefined) {
          const next = deriveNewContent(atOld, entry);
          if (next !== undefined) {
            if (!warnedUnapplied) {
              warnedUnapplied = true;
              warnings.push('Yama bu klasöre uygulanmamış görünüyor: eski içerik diskten okundu, yeni içerik yama uygulanarak üretildi.');
            }
            return { old: atOld, new: next };
          }
        }
        return {};
      })();
      resolved.set(key, p);
    }
    return p;
  };

  // Diff dışındaki dosyalar (çağıran/alt sınıf indeksi için): yalnız git'in izlediği ya da yoksaymadığı dosyalar
  // okunur (.env gibi yoksayılanlar asla). Klasör git deposu değilse liste boştur.
  let tracked: Promise<Set<string> | undefined> | undefined;
  const loadTracked = (): Promise<Set<string> | undefined> => {
    if (root === undefined) return Promise.resolve(undefined);
    tracked ??= runGit(root, ['ls-files', '-z', '-co', '--exclude-standard'])
      .then((out) => new Set(out.split('\0').filter((p) => p !== '' && !isOsJunkFile(p))))
      .catch(() => undefined);
    return tracked;
  };

  return {
    info: {
      kind: 'patch',
      title: patchTitle(opts.text, files.length),
      repoPath: root,
      baseRef: 'patch-base',
      headRef: 'patch',
      stableKey: patchStableKey(opts.text),
    },
    files,
    warnings,
    async readFile(side, rawPath) {
      const path = sanitizeRepoRelPath(rawPath);
      if (path === undefined) return undefined;
      const t = sideOf(side, path);
      if (t.path === undefined || t.binary) return undefined;
      // Yamadaki kayıt: yeni tarafta yoluyla; eski tarafta (taşınmışsa) eski yoluyla.
      const entry = side === 'new' ? byPath.get(path) : (byOldPath.get(path) ?? byPath.get(path));
      if (entry) {
        const c = await contentsOf(entry);
        return side === 'new' ? c.new : c.old;
      }
      // Yamada geçmeyen dosya: iki tarafta da aynıdır.
      const set = await loadTracked();
      if (!set?.has(path)) return undefined;
      return await disk(path);
    },
    async listFiles(_side, ext) {
      const set = await loadTracked();
      if (!set) return [];
      const all = new Set(set);
      for (const f of files) {
        if (f.status === 'deleted') all.delete(f.path);
        else all.add(f.path);
        if (f.status === 'renamed' && f.oldPath !== undefined) all.delete(f.oldPath);
      }
      return filterByExt([...all].sort(), ext);
    },
    dispose() {
      /* tutulan kaynak yok */
    },
  };
}

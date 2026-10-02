/**
 * Yapıştırılan unified diff / `git format-patch` metninden ChangeSet.
 * - Eklenen dosyanın yeni içeriği ve silinen dosyanın eski içeriği hunk'lardan kurulur (tam içerik oldukları için;
 *   repoPath gerekmez).
 * - Değişen dosyalarda repoPath verilirse yeni taraf diskten okunur, eski taraf yamanın tersi uygulanarak türetilir.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyPatch, reversePatch, type StructuredPatch } from 'diff';
import {
  createSideResolver,
  isBinaryBuffer,
  patchStableKey,
  resolveInside,
  sanitizeRepoRelPath,
  type ManagedChangeSet,
} from './common.js';
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

  const readNewFromDisk = async (path: string): Promise<string | undefined> => {
    if (root === undefined) return undefined;
    // Yalnızca yamada geçen dosyalar okunur (repo içindeki rastgele dosyalar değil).
    const entry = byPath.get(path);
    if (!entry || entry.file.status === 'deleted' || entry.file.binary) return undefined;
    const abs = resolveInside(root, path);
    if (!abs) return undefined;
    try {
      const buf = await readFile(abs);
      return isBinaryBuffer(buf) ? undefined : buf.toString('utf8');
    } catch {
      return undefined;
    }
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
      if (side === 'new') {
        const added = byPath.get(path);
        // Eklenen dosyanın tüm satırları yamada '+' olarak bulunur; disk gerekmez.
        if (added?.file.status === 'added') return contentFromAddition(added) ?? (await readNewFromDisk(path));
        return await readNewFromDisk(path);
      }
      // old: yamadaki kaydı bul (taşınmışsa eski yoluyla, değilse yoluyla)
      const entry = byOldPath.get(path) ?? byPath.get(path);
      if (!entry || entry.file.status === 'added') return undefined;
      // Silinen dosyanın tüm satırları yamada '-' olarak bulunur; disk gerekmez.
      if (entry.file.status === 'deleted') return contentFromDeletion(entry);
      const current = await readNewFromDisk(entry.file.path);
      if (current === undefined) return undefined;
      return deriveOldContent(current, entry);
    },
    async listFiles() {
      return [];
    },
    dispose() {
      /* tutulan kaynak yok */
    },
  };
}

/**
 * Yapıştırılan unified diff / `git format-patch` metninden ChangeSet.
 * repoPath verilirse yeni taraf diskten okunur, eski taraf yamanın tersi uygulanarak türetilir.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyPatch, reversePatch, type StructuredPatch } from 'diff';
import { createSideResolver, isBinaryBuffer, normalizeRepoPath, resolveInside, type ManagedChangeSet } from './common.js';
import { parseUnifiedDiffDetailed, type ParsedDiffFile } from './unifiedDiff.js';

export interface PatchChangeSetOptions {
  text: string;
  repoPath?: string;
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

/** Silme yamasından dosyanın tam eski içeriğini kurar (`\ No newline` dikkate alınır). */
export function contentFromDeletion(parsed: ParsedDiffFile): string | undefined {
  const h = parsed.rawHunks;
  if (h.length !== 1 || h[0]?.oldStart !== 1) return h.length === 0 ? '' : undefined;
  const lines = h[0].lines;
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (!l.startsWith('-')) continue;
    out += l.slice(1);
    if (!(lines[i + 1] ?? '').startsWith('\\')) out += '\n';
  }
  return out;
}

export async function createPatchChangeSet(opts: PatchChangeSetOptions): Promise<ManagedChangeSet> {
  const parsed = parseUnifiedDiffDetailed(opts.text);
  const files = parsed.map((p) => p.file);
  const byPath = new Map(parsed.map((p) => [p.file.path, p]));
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
    },
    files,
    warnings,
    async readFile(side, rawPath) {
      if (root === undefined) return undefined;
      const path = normalizeRepoPath(rawPath);
      const t = sideOf(side, path);
      if (t.path === undefined || t.binary) return undefined;
      if (side === 'new') return await readNewFromDisk(path);
      // old: yamadaki dosyayı bul (yeni yoluyla), yeni içerikten ters uygula
      const entry = byPath.get(path) ?? parsed.find((p) => p.file.oldPath === path);
      if (!entry) return undefined;
      // Silinen dosyanın tüm satırları yamada '-' olarak bulunur.
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

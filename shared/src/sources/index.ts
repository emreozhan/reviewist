/**
 * Yerel kaynaklar: git aralığı, çalışma ağacı ve patch isteklerini doğrular ve ChangeSet'e çevirir.
 * Bu modül ağa çıkan hiçbir kod içermez; uzak depo desteği ayrı uygulamadadır (github/).
 */
import { resolve } from 'node:path';
import { z } from 'zod';
import type { LocalReviewRequest } from '../shared/types.js';
import type { ManagedChangeSet } from './common.js';
import { expandHome, isNetworkPath, NETWORK_PATH_MESSAGE } from './common.js';
import { createGitChangeSet, createWorktreeChangeSet } from './git.js';
import { createPatchChangeSet } from './patch.js';
import { parseWithSchema, str } from './validation.js';

export type { ManagedChangeSet } from './common.js';
export { SourceError, isSourceError } from './errors.js';
export { formatZodError, zodErrorField } from './validation.js';

const MAX_PATCH_CHARS = 50 * 1024 * 1024;

/** Yerel depo yolu: ağ yolu (UNC) kabul edilmez. */
const localPath = (field: string) => str(field).refine((p) => !isNetworkPath(p), { error: NETWORK_PATH_MESSAGE });

const gitSchema = z.object({
  kind: z.literal('git'),
  repoPath: localPath('repoPath'),
  base: str('base'),
  head: str('head'),
  mode: z.enum(['range', 'mergeBase'], { error: "mode 'range' ya da 'mergeBase' olmalı" }).optional(),
});

const worktreeSchema = z.object({
  kind: z.literal('worktree'),
  repoPath: localPath('repoPath'),
  base: str('base').optional(),
  includeUntracked: z.boolean({ error: 'includeUntracked true/false olmalı' }).optional(),
});

const patchSchema = z.object({
  kind: z.literal('patch'),
  text: z
    .string({ error: 'text metin olmalı' })
    .min(1, { error: 'text boş olamaz' })
    .max(MAX_PATCH_CHARS, { error: 'text çok büyük (en fazla 50 MB)' }),
  repoPath: localPath('repoPath').optional(),
});

export const localRequestSchema = z.discriminatedUnion('kind', [gitSchema, worktreeSchema, patchSchema], {
  error: "kind alanı 'git', 'worktree' ya da 'patch' olmalı",
});

/** Gövdeyi yerel inceleme isteği olarak doğrular; hatada 400 SourceError. */
export function parseLocalRequest(input: unknown): LocalReviewRequest {
  return parseWithSchema(localRequestSchema, input);
}

/** İstekteki `~` kısaltmasını açar ve göreli depo yollarını `baseDir`'e göre mutlaklaştırır. */
export function absolutizeLocalRequest(req: LocalReviewRequest, baseDir: string): LocalReviewRequest {
  const abs = (p: string): string => resolve(baseDir, expandHome(p));
  switch (req.kind) {
    case 'git':
    case 'worktree':
      return { ...req, repoPath: abs(req.repoPath) };
    case 'patch':
      return req.repoPath ? { ...req, repoPath: abs(req.repoPath) } : req;
  }
}

export interface CreateChangeSetOptions {
  onProgress?: (msg: string) => void;
}

/** Yerel isteği (doğrulayarak) ChangeSet'e çevirir. Çağıran iş bitince `dispose()` etmelidir. */
export async function createLocalChangeSet(req: unknown, opts: CreateChangeSetOptions = {}): Promise<ManagedChangeSet> {
  const r = parseLocalRequest(req);
  const onProgress = opts.onProgress;
  switch (r.kind) {
    case 'git':
      return await createGitChangeSet({ repoPath: r.repoPath, base: r.base, head: r.head, mode: r.mode ?? 'mergeBase', onProgress });
    case 'worktree':
      return await createWorktreeChangeSet({ repoPath: r.repoPath, base: r.base, includeUntracked: r.includeUntracked ?? true, onProgress });
    case 'patch':
      return await createPatchChangeSet({ text: r.text, repoPath: r.repoPath, onProgress });
  }
}

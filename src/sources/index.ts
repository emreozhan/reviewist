/**
 * Kaynak katmanı giriş noktası: ReviewRequest'i doğrular ve uygun kaynaktan ChangeSet üretir.
 */
import { z } from 'zod';
import type { ReviewRequest } from '../shared/types.js';
import type { ManagedChangeSet } from './common.js';
import { SourceError } from './errors.js';
import { createGitChangeSet, createWorktreeChangeSet } from './git.js';
import { createGithubChangeSet } from './github.js';
import { createPatchChangeSet } from './patch.js';

export type { ManagedChangeSet } from './common.js';
export { SourceError, isSourceError } from './errors.js';

const MAX_PATCH_CHARS = 50 * 1024 * 1024;

const str = (field: string) =>
  z
    .string({ error: `${field} metin olmalı` })
    .trim()
    .min(1, { error: `${field} boş olamaz` });

const gitSchema = z.object({
  kind: z.literal('git'),
  repoPath: str('repoPath'),
  base: str('base'),
  head: str('head'),
  mode: z.enum(['range', 'mergeBase'], { error: "mode 'range' ya da 'mergeBase' olmalı" }).optional(),
});

const worktreeSchema = z.object({
  kind: z.literal('worktree'),
  repoPath: str('repoPath'),
  base: str('base').optional(),
  includeUntracked: z.boolean({ error: 'includeUntracked true/false olmalı' }).optional(),
});

const githubSchema = z.object({
  kind: z.literal('github'),
  url: str('url'),
  token: z.string({ error: 'token metin olmalı' }).optional(),
  localRepoPath: str('localRepoPath').optional(),
});

const patchSchema = z.object({
  kind: z.literal('patch'),
  text: z
    .string({ error: 'text metin olmalı' })
    .min(1, { error: 'text boş olamaz' })
    .max(MAX_PATCH_CHARS, { error: 'text çok büyük (en fazla 50 MB)' }),
  repoPath: str('repoPath').optional(),
});

export const reviewRequestSchema = z.discriminatedUnion('kind', [gitSchema, worktreeSchema, githubSchema, patchSchema], {
  error: "kind alanı 'git', 'worktree', 'github' ya da 'patch' olmalı",
});

/** zod hatasını `alan: mesaj` satırlarına çevirir (token gibi değerler mesaja girmez). */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length > 0 ? i.path.map(String).join('.') : '(gövde)';
      return `${path}: ${i.message}`;
    })
    .join('; ');
}

/** Gövdeyi ReviewRequest olarak doğrular; hatada 400 SourceError. */
export function parseReviewRequest(input: unknown): ReviewRequest {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new SourceError('İstek gövdesi bir JSON nesnesi olmalı.', { status: 400, code: 'VALIDATION' });
  }
  const r = reviewRequestSchema.safeParse(input);
  if (!r.success) {
    throw new SourceError(`Geçersiz review isteği: ${formatZodError(r.error)}`, {
      status: 400,
      code: 'VALIDATION',
    });
  }
  return r.data;
}

export interface CreateChangeSetOptions {
  /** GitHub token'ı için bakılacak ortam değişkenleri (CLI --token-env ile genişletilir). */
  tokenEnvNames?: readonly string[];
  onProgress?: (msg: string) => void;
}

/** ReviewRequest'i (doğrulayarak) ChangeSet'e çevirir. Çağıran iş bitince `dispose()` etmelidir. */
export async function createChangeSet(
  req: ReviewRequest | unknown,
  opts: CreateChangeSetOptions = {},
): Promise<ManagedChangeSet> {
  const r = parseReviewRequest(req);
  switch (r.kind) {
    case 'git':
      return await createGitChangeSet({ repoPath: r.repoPath, base: r.base, head: r.head, mode: r.mode ?? 'mergeBase' });
    case 'worktree':
      return await createWorktreeChangeSet({
        repoPath: r.repoPath,
        base: r.base,
        includeUntracked: r.includeUntracked ?? true,
      });
    case 'github':
      return await createGithubChangeSet({
        url: r.url,
        token: r.token,
        localRepoPath: r.localRepoPath,
        tokenEnvNames: opts.tokenEnvNames,
        onProgress: opts.onProgress,
      });
    case 'patch':
      return await createPatchChangeSet({ text: r.text, repoPath: r.repoPath });
  }
}

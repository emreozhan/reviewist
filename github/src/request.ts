/**
 * GitHub uygulamasının istek doğrulayıcısı: yalnız `{ kind: 'github', url, base?, head? }` kabul edilir. Adres ve ref
 * adları burada da denetlenir; böylece hatalı istek iş kuyruğuna girmeden 400 ile döner.
 */
import { z } from 'zod';
import type { GithubReviewRequest } from '../../shared/src/shared/types.js';
import { SourceError } from '../../shared/src/sources/errors.js';
import { parseWithSchema, str } from '../../shared/src/sources/validation.js';
import { parseRemoteSpec } from './remote.js';
import { assertRefName } from './source.js';

export const ONLY_GITHUB_MESSAGE =
  "Bu uygulama yalnız uzak (GitHub) depoları inceler; yerel depolar için Reviewist Yerel'i kullanın.";

export const githubRequestSchema = z.object({
  kind: z.literal('github', { error: ONLY_GITHUB_MESSAGE }),
  url: str('url').max(2000, { error: 'url çok uzun (en fazla 2000 karakter)' }),
  base: str('base').max(255, { error: 'base çok uzun' }).optional(),
  head: str('head').max(255, { error: 'head çok uzun' }).optional(),
});

/** Gövdeyi uzak inceleme isteği olarak doğrular; hatada 400 SourceError (`field` ilgili alan). */
export function parseGithubRequest(body: unknown): GithubReviewRequest {
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'kind' in body && body.kind !== 'github') {
    throw new SourceError(ONLY_GITHUB_MESSAGE, { status: 400, code: 'VALIDATION', field: 'kind' });
  }
  const req = parseWithSchema(githubRequestSchema, body);
  const remote = parseRemoteSpec(req.url);
  if (req.base !== undefined) assertRefName(req.base, 'base');
  if (req.head !== undefined && !/^[0-9a-f]{7,40}$/i.test(req.head)) assertRefName(req.head, 'head');
  if (remote.prNumber === undefined && req.head === undefined) {
    throw new SourceError("Depo adresi verildiğinde incelenecek dal (head) zorunludur: dal, etiket ya da commit SHA'sı girin.", {
      status: 400,
      code: 'VALIDATION',
      field: 'head',
    });
  }
  const out: GithubReviewRequest = { kind: 'github', url: req.url };
  if (req.base !== undefined) out.base = req.base;
  if (req.head !== undefined) out.head = req.head;
  return out;
}

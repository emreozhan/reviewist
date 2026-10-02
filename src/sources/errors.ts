/**
 * Kaynak katmanının (git, GitHub, patch) kullanıcıya dönük hata tipi.
 * `status` HTTP katmanında doğrudan yanıt koduna çevrilir; `message` Türkçe ve yönlendiricidir.
 * `detail` kısa teknik bilgi taşır (stderr özeti, HTTP kodu); token ya da gizli bilgi İÇERMEZ.
 */
export type SourceErrorCode =
  | 'VALIDATION'
  | 'GIT_NOT_FOUND'
  | 'PATH_NOT_FOUND'
  | 'NOT_A_REPO'
  | 'REF_NOT_FOUND'
  | 'GIT_FAILED'
  | 'GITHUB_AUTH'
  | 'GITHUB_FORBIDDEN'
  | 'GITHUB_RATE_LIMIT'
  | 'GITHUB_NOT_FOUND'
  | 'GITHUB_FAILED'
  | 'BAD_URL'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'ENGINE';

export class SourceError extends Error {
  readonly status: number;
  readonly code: SourceErrorCode;
  readonly detail?: string;
  /** Hatanın ilgili olduğu istek alanı (ör. 'repoPath', 'base', 'head', 'url', 'token'); ApiError.field'e taşınır. */
  readonly field?: string;

  constructor(message: string, opts: { status: number; code: SourceErrorCode; detail?: string; field?: string }) {
    super(message);
    this.name = 'SourceError';
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
    this.field = opts.field;
  }
}

export function isSourceError(err: unknown): err is SourceError {
  return err instanceof SourceError;
}

/** Hata nesnesinden kısa, tek satırlık teknik mesaj üretir (stack yok). */
export function shortMessage(err: unknown, max = 300): string {
  const raw = err instanceof Error ? err.message : String(err);
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

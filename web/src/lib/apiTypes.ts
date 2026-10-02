import type { AppConfig, GitRefs, ReviewListItem, ReviewModel, ReviewRequest } from '../../../src/shared/types';

export type FileSide = 'old' | 'new';

export interface FileContentResponse {
  path: string;
  side: FileSide;
  content: string | null;
}

/** Sunucu API'sinin istemci arayüzü; gerçek ve mock uygulaması aynı imzayı paylaşır. */
export interface ReviewApi {
  getConfig(): Promise<AppConfig>;
  getRefs(repoPath: string): Promise<GitRefs>;
  createReview(req: ReviewRequest, signal?: AbortSignal): Promise<ReviewModel>;
  listReviews(): Promise<ReviewListItem[]>;
  getReview(id: string): Promise<ReviewModel>;
  getFile(id: string, path: string, side: FileSide): Promise<FileContentResponse>;
}

export type ApiErrorKind = 'unreachable' | 'http' | 'parse' | 'aborted';

/** Kullanıcıya gösterilecek Türkçe mesajı taşıyan istemci hatası. */
export class ApiRequestError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly detail?: string;
  readonly endpoint: string;

  constructor(message: string, opts: { kind: ApiErrorKind; endpoint: string; status?: number; detail?: string }) {
    super(message);
    this.name = 'ApiRequestError';
    this.kind = opts.kind;
    this.status = opts.status;
    this.detail = opts.detail;
    this.endpoint = opts.endpoint;
  }
}

export function isApiError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

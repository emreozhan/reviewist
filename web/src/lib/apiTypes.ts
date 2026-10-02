import type { AppConfig, GitRefs, ReviewJob, ReviewListItem, ReviewModel, ReviewRequest } from '../../../src/shared/types';

export type FileSide = 'old' | 'new';

export interface FileContentResponse {
  path: string;
  side: FileSide;
  content: string | null;
}

/** Büyük yanıtın yüklenme aşaması: indirme (bayt), JSON ayrıştırma, istemci indeksi kurma. */
export interface LoadProgress {
  phase: 'download' | 'parse' | 'index';
  /** İndirilen (açılmış) bayt. */
  loaded: number;
  /** Toplam bayt; sunucu sıkıştırıyorsa (gzip) bilinmez. */
  total?: number;
}

export type ProgressFn = (p: LoadProgress) => void;

export interface LoadOptions {
  signal?: AbortSignal;
  onProgress?: ProgressFn;
}

/** Sunucu API'sinin istemci arayüzü; gerçek ve mock uygulaması aynı imzayı paylaşır. */
export interface ReviewApi {
  getConfig(): Promise<AppConfig>;
  getRefs(repoPath: string): Promise<GitRefs>;
  /** Senkron analiz (eski uç; jobs desteklenmiyorsa yedek). */
  createReview(req: ReviewRequest, signal?: AbortSignal, onProgress?: ProgressFn): Promise<ReviewModel>;
  /** Arka planda analiz işi başlatır (202). */
  createJob(req: ReviewRequest, signal?: AbortSignal): Promise<ReviewJob>;
  getJob(id: string, signal?: AbortSignal): Promise<ReviewJob>;
  deleteReview(id: string): Promise<void>;
  listReviews(): Promise<ReviewListItem[]>;
  /** Büyük model (onlarca MB) indirilirken `onProgress` ile ilerleme bildirilir. */
  getReview(id: string, opts?: LoadOptions): Promise<ReviewModel>;
  getFile(id: string, path: string, side: FileSide): Promise<FileContentResponse>;
}

/** `analysis`: iş sunucuda hata durumuyla bitti (job.error). */
export type ApiErrorKind = 'unreachable' | 'http' | 'parse' | 'aborted' | 'analysis';

/** Kullanıcıya gösterilecek Türkçe mesajı taşıyan istemci hatası. */
export class ApiRequestError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly detail?: string;
  readonly endpoint: string;
  /** Doğrulama hatasında ilgili istek alanı (ör. 'base', 'url'). */
  readonly field?: string;
  /** Yanıt gövdesi ApiError biçimindeydi (sunucu bilerek döndürdü; ör. 404 "uç yok" değil). */
  readonly fromServerBody: boolean;

  constructor(
    message: string,
    opts: { kind: ApiErrorKind; endpoint: string; status?: number; detail?: string; field?: string; fromServerBody?: boolean },
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.kind = opts.kind;
    this.status = opts.status;
    this.detail = opts.detail;
    this.endpoint = opts.endpoint;
    this.field = opts.field;
    this.fromServerBody = opts.fromServerBody ?? false;
  }
}

export function isApiError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

/** Sunucu bu ucu hiç tanımıyor mu (eski sürüm): gövdesiz 404/405. */
export function isMissingEndpoint(error: unknown): boolean {
  return isApiError(error) && error.kind === 'http' && (error.status === 404 || error.status === 405) && !error.fromServerBody;
}

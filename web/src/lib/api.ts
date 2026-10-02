import type { ApiError, AppConfig, GitRefs, ReviewJob, ReviewListItem, ReviewModel, ReviewRequest } from '../../../src/shared/types';
import type { FileContentResponse, FileSide, ReviewApi } from './apiTypes';
import { ApiRequestError } from './apiTypes';
import { mockApi } from './mockApi';

export { ApiRequestError, isApiError, isMissingEndpoint } from './apiTypes';
export type { ReviewApi, FileSide, FileContentResponse } from './apiTypes';

function isApiErrorBody(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string';
}

/** Vite proxy'si arka uca ulaşamazsa 502/503/504 ya da HTML döner; bunları "erişilemez" sayarız. */
const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

async function request<T>(endpoint: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(endpoint, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiRequestError('İstek iptal edildi.', { kind: 'aborted', endpoint });
    }
    throw new ApiRequestError('Reviewist sunucusuna ulaşılamadı.', {
      kind: 'unreachable',
      endpoint,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  if (!res.ok) {
    let body: unknown = null;
    if (isJson) {
      try {
        body = await res.json();
      } catch (error) {
        console.warn('Hata gövdesi okunamadı', error);
      }
    }
    if (isApiErrorBody(body)) {
      throw new ApiRequestError(body.error, { kind: 'http', endpoint, status: res.status, detail: body.detail, field: body.field, fromServerBody: true });
    }
    if (UNREACHABLE_STATUSES.has(res.status) || (res.status === 500 && !isJson)) {
      throw new ApiRequestError('Reviewist sunucusuna ulaşılamadı.', { kind: 'unreachable', endpoint, status: res.status });
    }
    throw new ApiRequestError(`Sunucu beklenmeyen bir yanıt döndü (HTTP ${res.status}).`, { kind: 'http', endpoint, status: res.status });
  }
  if (!isJson) {
    throw new ApiRequestError('Sunucu JSON yerine farklı bir yanıt döndü; API çalışmıyor olabilir.', { kind: 'unreachable', endpoint, status: res.status });
  }
  try {
    return (await res.json()) as T;
  } catch (error) {
    throw new ApiRequestError('Sunucu yanıtı çözümlenemedi.', { kind: 'parse', endpoint, detail: error instanceof Error ? error.message : String(error) });
  }
}

export const realApi: ReviewApi = {
  getConfig: () => request<AppConfig>('/api/config'),
  getRefs: (repoPath) => request<GitRefs>(`/api/git/refs?repoPath=${encodeURIComponent(repoPath)}`),
  createReview: (req: ReviewRequest, signal?: AbortSignal) =>
    request<ReviewModel>('/api/reviews', { method: 'POST', body: JSON.stringify(req), signal }),
  createJob: (req: ReviewRequest, signal?: AbortSignal) =>
    request<ReviewJob>('/api/jobs', { method: 'POST', body: JSON.stringify(req), signal }),
  getJob: (id: string, signal?: AbortSignal) => request<ReviewJob>(`/api/jobs/${encodeURIComponent(id)}`, { signal }),
  deleteReview: async (id: string) => {
    await request<{ ok: true }>(`/api/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  listReviews: () => request<ReviewListItem[]>('/api/reviews'),
  getReview: (id) => request<ReviewModel>(`/api/reviews/${encodeURIComponent(id)}`),
  getFile: (id: string, path: string, side: FileSide) =>
    request<FileContentResponse>(`/api/reviews/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}&side=${side}`),
};

export function getApi(mock: boolean): ReviewApi {
  return mock ? mockApi : realApi;
}

/** Hata için kullanıcıyı yönlendiren kısa Türkçe ipucu. */
export function errorHint(error: ApiRequestError): string {
  if (error.kind === 'unreachable') return 'Sunucuyu `npm run dev:server` (veya `npx reviewist`) ile başlatın; ya da örnek veriyle devam edin.';
  if (error.kind === 'aborted') return 'Analizi yeniden başlatabilirsiniz.';
  if (error.kind === 'analysis') return error.field ? 'İlgili form alanını düzeltip tekrar deneyin.' : 'Analiz sunucuda tamamlanamadı. Ayrıntı aşağıda ve sunucu günlüğünde.';
  if (error.status === 400 || error.status === 422) return 'Formdaki alanları kontrol edin: repo yolu, ref adları veya URL geçerli olmalı.';
  if (error.status === 401 || error.status === 403) return 'Erişim reddedildi: GitHub token\'ının bu depoya okuma izni olduğundan emin olun.';
  if (error.status === 404) return 'İstenen kayıt bulunamadı: repo yolu, ref ya da review kimliği yanlış olabilir.';
  if (error.status && error.status >= 500) return 'Analiz sırasında sunucuda hata oluştu. Ayrıntıyı sunucu günlüğünde görebilirsiniz.';
  return 'Girdileri kontrol edip tekrar deneyin.';
}

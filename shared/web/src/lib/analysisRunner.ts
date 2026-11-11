import type { ReviewJob, ReviewModel, ReviewRequest } from '../../../src/shared/types';
import type { LoadProgress, ReviewApi } from './apiTypes';
import { ApiRequestError, isMissingEndpoint } from './apiTypes';

export const POLL_INTERVAL_MS = 400;
/** İş sorgusunda art arda bu kadar geçici hataya kadar yeniden denenir. */
export const MAX_POLL_FAILURES = 5;

/**
 * Sorgu hatası geçici mi (ağ kopması, zaman aşımı, 5xx, bozuk yanıt)? İptal ve 4xx (404: iş yok, 403: reddedildi…)
 * kalıcıdır: izleme hemen biter.
 */
export function isTransientPollError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    if (error.kind === 'aborted') return false;
    if (error.status !== undefined && error.status >= 400 && error.status < 500) return false;
    return true;
  }
  return !(error instanceof DOMException && error.name === 'AbortError');
}

export interface AnalysisProgressState {
  /** 'job': sunucu ilerleme bildiriyor; 'sync': eski senkron uç, ilerleme yok. */
  mode: 'job' | 'sync';
  messages: ReviewJob['progress'];
  /** Sonuç modeli indirilirken/ayrıştırılırken. */
  download?: LoadProgress;
}

export interface RunOptions {
  signal: AbortSignal;
  onProgress: (state: AnalysisProgressState) => void;
  /** Testlerde beklemeyi kısaltmak için. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function aborted(): ApiRequestError {
  return new ApiRequestError('İstek iptal edildi.', { kind: 'aborted', endpoint: '/api/jobs' });
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(aborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function jobFailure(job: ReviewJob): ApiRequestError {
  const e = job.error;
  return new ApiRequestError(e?.error ?? 'Analiz sunucuda başarısız oldu.', {
    kind: 'analysis',
    endpoint: `/api/jobs/${job.id}`,
    detail: e?.detail,
    field: e?.field,
    fromServerBody: true,
  });
}

/**
 * Analizi iş (job) olarak başlatır ve ~400 ms aralıkla sorgular; ilerleme mesajlarını iletir.
 * Sunucu `/api/jobs` ucunu tanımıyorsa (gövdesiz 404) senkron `POST /api/reviews`'a düşer.
 * Tek bir sorgu hatası izlemeyi bitirmez: geçici hatalarda art arda `MAX_POLL_FAILURES` kez yeniden denenir.
 * İptal: sorgulama bırakılır (sunucudaki iş kendi kendine biter).
 */
export async function runAnalysis(api: ReviewApi, req: ReviewRequest, opts: RunOptions): Promise<ReviewModel> {
  const wait = opts.sleep ?? sleep;
  let job: ReviewJob;
  try {
    job = await api.createJob(req, opts.signal);
  } catch (error) {
    if (!isMissingEndpoint(error)) throw error;
    opts.onProgress({ mode: 'sync', messages: [] });
    return api.createReview(req, opts.signal, (download) => opts.onProgress({ mode: 'sync', messages: [], download }));
  }
  let seen = -1;
  let failures = 0;
  for (;;) {
    if (job.progress.length !== seen) {
      seen = job.progress.length;
      opts.onProgress({ mode: 'job', messages: job.progress });
    }
    if (job.status === 'error') throw jobFailure(job);
    if (job.status === 'done') {
      if (!job.reviewId) throw new ApiRequestError('İş tamamlandı ama inceleme kimliği dönmedi.', { kind: 'parse', endpoint: `/api/jobs/${job.id}` });
      const messages = job.progress;
      return api.getReview(job.reviewId, { signal: opts.signal, onProgress: (download) => opts.onProgress({ mode: 'job', messages, download }) });
    }
    await wait(POLL_INTERVAL_MS, opts.signal);
    try {
      job = await api.getJob(job.id, opts.signal);
      failures = 0;
    } catch (error) {
      if (opts.signal.aborted) throw aborted();
      failures++;
      if (!isTransientPollError(error) || failures >= MAX_POLL_FAILURES) throw error;
      console.warn(`İş durumu alınamadı (${failures}/${MAX_POLL_FAILURES}); yeniden denenecek`, error);
    }
  }
}

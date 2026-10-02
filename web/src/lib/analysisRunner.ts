import type { ReviewJob, ReviewModel, ReviewRequest } from '../../../src/shared/types';
import type { ReviewApi } from './apiTypes';
import { ApiRequestError, isMissingEndpoint } from './apiTypes';

export const POLL_INTERVAL_MS = 400;

export interface AnalysisProgressState {
  /** 'job': sunucu ilerleme bildiriyor; 'sync': eski senkron uç, ilerleme yok. */
  mode: 'job' | 'sync';
  messages: ReviewJob['progress'];
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
    return api.createReview(req, opts.signal);
  }
  let seen = -1;
  for (;;) {
    if (job.progress.length !== seen) {
      seen = job.progress.length;
      opts.onProgress({ mode: 'job', messages: job.progress });
    }
    if (job.status === 'error') throw jobFailure(job);
    if (job.status === 'done') {
      if (!job.reviewId) throw new ApiRequestError('İş tamamlandı ama review kimliği dönmedi.', { kind: 'parse', endpoint: `/api/jobs/${job.id}` });
      return api.getReview(job.reviewId);
    }
    await wait(POLL_INTERVAL_MS, opts.signal);
    job = await api.getJob(job.id, opts.signal);
  }
}

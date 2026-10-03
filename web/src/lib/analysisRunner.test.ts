import { describe, expect, it, vi } from 'vitest';
import type { ReviewJob, ReviewModel, ReviewRequest } from '../../../src/shared/types';
import type { ReviewApi } from './apiTypes';
import { ApiRequestError } from './apiTypes';
import type { AnalysisProgressState } from './analysisRunner';
import { runAnalysis } from './analysisRunner';

const REQ: ReviewRequest = { kind: 'git', repoPath: '/r', base: 'main', head: 'f' };
const MODEL = { id: 'rv1' } as ReviewModel;
const noSleep = async () => undefined;

function job(status: ReviewJob['status'], messages: string[], extra: Partial<ReviewJob> = {}): ReviewJob {
  return { id: 'j1', status, startedAt: '2026-10-03T00:00:00Z', progress: messages.map((m) => ({ at: '2026-10-03T00:00:00Z', message: m })), ...extra };
}

function fakeApi(overrides: Partial<ReviewApi>): ReviewApi {
  const fail = () => Promise.reject(new Error('beklenmeyen çağrı'));
  return {
    getConfig: fail,
    getRefs: fail,
    createReview: fail,
    createJob: fail,
    getJob: fail,
    deleteReview: fail,
    listReviews: fail,
    getReview: fail,
    getFile: fail,
    getOutline: fail,
    locate: fail,
    ...overrides,
  };
}

describe('analiz işi', () => {
  it('işi sorgular, yalnız yeni mesajlarda ilerleme bildirir, bitince review getirir', async () => {
    const polls = [job('running', ['a', 'b']), job('running', ['a', 'b']), job('done', ['a', 'b', 'c'], { reviewId: 'rv1' })];
    const getJob = vi.fn(async () => polls.shift() ?? job('error', []));
    const getReview = vi.fn(async () => MODEL);
    const api = fakeApi({ createJob: async () => job('running', ['a']), getJob, getReview });
    const seen: AnalysisProgressState[] = [];
    const out = await runAnalysis(api, REQ, { signal: new AbortController().signal, onProgress: (p) => seen.push(p), sleep: noSleep });
    expect(out).toBe(MODEL);
    expect(getReview).toHaveBeenCalledWith('rv1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(getJob).toHaveBeenCalledTimes(3);
    expect(seen.map((s) => s.messages.map((m) => m.message).join(''))).toEqual(['a', 'ab', 'abc']);
    expect(seen.every((s) => s.mode === 'job')).toBe(true);
  });

  it('iş hata ile biterse alanlı ApiRequestError fırlatır', async () => {
    const api = fakeApi({
      createJob: async () => job('error', ['x'], { error: { error: 'Ref bulunamadı: yok', field: 'base', detail: 'git: unknown revision' } }),
    });
    const err = await runAnalysis(api, REQ, { signal: new AbortController().signal, onProgress: () => undefined, sleep: noSleep }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ kind: 'analysis', message: 'Ref bulunamadı: yok', field: 'base', detail: 'git: unknown revision' });
  });

  it('jobs ucu yoksa (gövdesiz 404) senkron uca düşer', async () => {
    const createReview = vi.fn(async () => MODEL);
    const api = fakeApi({
      createJob: async () => {
        throw new ApiRequestError('Sunucu beklenmeyen bir yanıt döndü (HTTP 404).', { kind: 'http', status: 404, endpoint: '/api/jobs' });
      },
      createReview,
    });
    const seen: AnalysisProgressState[] = [];
    const out = await runAnalysis(api, REQ, { signal: new AbortController().signal, onProgress: (p) => seen.push(p), sleep: noSleep });
    expect(out).toBe(MODEL);
    expect(createReview).toHaveBeenCalledOnce();
    expect(seen).toEqual([{ mode: 'sync', messages: [] }]);
  });

  it('ApiError gövdeli 404 (ör. repo yok) yedeğe düşmez, hatayı iletir', async () => {
    const createReview = vi.fn(async () => MODEL);
    const api = fakeApi({
      createJob: async () => {
        throw new ApiRequestError('Repo bulunamadı', { kind: 'http', status: 404, endpoint: '/api/jobs', field: 'repoPath', fromServerBody: true });
      },
      createReview,
    });
    await expect(runAnalysis(api, REQ, { signal: new AbortController().signal, onProgress: () => undefined, sleep: noSleep })).rejects.toMatchObject({ field: 'repoPath' });
    expect(createReview).not.toHaveBeenCalled();
  });

  it('iptal edilince sorgulamayı bırakır', async () => {
    const ac = new AbortController();
    const getJob = vi.fn(async () => job('running', ['a']));
    const api = fakeApi({ createJob: async () => job('running', []), getJob });
    const p = runAnalysis(api, REQ, { signal: ac.signal, onProgress: () => undefined });
    ac.abort();
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
    expect(getJob).not.toHaveBeenCalled();
  });
});

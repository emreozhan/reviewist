import type { AppConfig, GitRefs, ReviewListItem, ReviewModel, ReviewRequest } from '../../../src/shared/types';
import type { FileContentResponse, FileSide, ReviewApi } from './apiTypes';
import { ApiRequestError } from './apiTypes';

/** Mock veri yalnız mock modunda yüklensin diye dinamik içe aktarılır (ayrı chunk). */
async function sample() {
  const [{ sampleReview, SAMPLE_REVIEW_ID }, { sampleFiles }] = await Promise.all([
    import('../mock/sampleReview'),
    import('../mock/sampleFiles'),
  ]);
  return { sampleReview, SAMPLE_REVIEW_ID, sampleFiles };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(t);
      reject(new ApiRequestError('İstek iptal edildi.', { kind: 'aborted', endpoint: 'mock' }));
    });
  });
}

const created: ReviewModel[] = [];

function titleFor(req: ReviewRequest): string | null {
  switch (req.kind) {
    case 'git':
      return `${req.base}...${req.head}`;
    case 'worktree':
      return `${req.base ?? 'HEAD'}...çalışma ağacı`;
    case 'github':
      return null;
    case 'patch':
      return 'Yapıştırılan patch';
  }
}

export const mockApi: ReviewApi = {
  async getConfig(): Promise<AppConfig> {
    await delay(80);
    return { version: '0.1.0-mock', defaultRepoPath: 'C:/work/shop', githubTokenConfigured: false };
  },
  async getRefs(repoPath: string): Promise<GitRefs> {
    await delay(150);
    return {
      repoPath,
      currentBranch: 'feature/ai-refactor',
      defaultBase: 'main',
      branches: ['main', 'develop', 'feature/ai-refactor', 'feature/small-fix', 'hotfix/stripe-timeout'],
      remoteBranches: ['origin/main', 'origin/develop', 'origin/feature/ai-refactor'],
      tags: ['v1.3.0', 'v1.3.1', 'v1.4.0-rc1'],
      recentCommits: [
        { sha: '7f3b2e91c4d8a6f0e2b5c9d1a7e4f8b3c6d0a2e5', subject: 'Ödeme akışını idempotent hale getir', author: 'ai-refactor-bot', date: '2026-10-02T09:12:00Z' },
        { sha: '3e8a1f0b9c2d7e6a5b4c3d2e1f0a9b8c7d6e5f4a', subject: 'Bildirimleri sadeleştir', author: 'ai-refactor-bot', date: '2026-10-02T08:40:00Z' },
        { sha: 'a1c9e04d7b2f6e3a9c1d5e8f0b4a7c2d9e6f1a3b', subject: 'Sürüm 1.3.1', author: 'Ayşe Yılmaz', date: '2026-09-28T15:03:00Z' },
      ],
    };
  },
  async createReview(req: ReviewRequest, signal?: AbortSignal): Promise<ReviewModel> {
    await delay(2600, signal);
    const { sampleReview } = await sample();
    const title = titleFor(req);
    const model: ReviewModel = title ? { ...sampleReview, source: { ...sampleReview.source, title } } : sampleReview;
    if (!created.some((r) => r.id === model.id)) created.push(model);
    return model;
  },
  async listReviews(): Promise<ReviewListItem[]> {
    await delay(60);
    const { sampleReview } = await sample();
    return [sampleReview].map((r) => ({ id: r.id, title: r.source.title, createdAt: r.createdAt, kind: r.source.kind, files: r.files.length }));
  },
  async getReview(id: string): Promise<ReviewModel> {
    await delay(120);
    const { sampleReview, SAMPLE_REVIEW_ID } = await sample();
    if (id === SAMPLE_REVIEW_ID) return created.find((r) => r.id === id) ?? sampleReview;
    throw new ApiRequestError(`Review bulunamadı: ${id}`, { kind: 'http', status: 404, endpoint: `mock:/api/reviews/${id}` });
  },
  async getFile(_id: string, path: string, side: FileSide): Promise<FileContentResponse> {
    await delay(90);
    const { sampleFiles } = await sample();
    return { path, side, content: sampleFiles[path]?.[side] ?? null };
  },
};

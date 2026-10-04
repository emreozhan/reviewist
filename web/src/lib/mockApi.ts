import type { AppConfig, FileOutline, FsListing, GitRefs, ReviewJob, ReviewListItem, ReviewModel, ReviewRequest, SymbolLocation } from '../../../src/shared/types';
import type { FileContentResponse, FileSide, LoadOptions, ProgressFn, ReviewApi } from './apiTypes';
import { ApiRequestError } from './apiTypes';

/** Mock veri yalnız mock modunda yüklensin diye dinamik içe aktarılır (ayrı chunk). */
async function sample() {
  const [{ sampleReview, SAMPLE_REVIEW_ID }, { sampleFiles }] = await Promise.all([
    import('../mock/sampleReview'),
    import('../mock/sampleFiles'),
  ]);
  return { sampleReview, SAMPLE_REVIEW_ID, sampleFiles };
}

/** Performans ve görsel kontrol için sentetik büyük review (2000 dosya, 20k üye); ilk istekte üretilir. */
const LARGE_ID = 'sentetik-buyuk';
let largeCache: ReviewModel | null = null;
async function large(): Promise<ReviewModel> {
  if (!largeCache) {
    const { makeLargeReview } = await import('../mock/largeReview');
    largeCache = makeLargeReview({ id: LARGE_ID });
  }
  return largeCache;
}

/** Gerçek API'deki gibi indirme ilerlemesi taklidi (~38 MB, sıkıştırılmış: toplam bilinmez). */
async function simulateDownload(onProgress: ProgressFn | undefined, signal?: AbortSignal): Promise<void> {
  if (!onProgress) return;
  const total = 38 * 1024 * 1024;
  for (let i = 1; i <= 8; i++) {
    await delay(90, signal);
    onProgress({ phase: 'download', loaded: Math.round((total * i) / 8) });
  }
  onProgress({ phase: 'parse', loaded: total });
  await delay(120, signal);
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
const deleted = new Set<string>();

/** Mock iş zaman çizelgesi: başlangıçtan bu kadar ms sonra bu mesaj eklenir. */
const JOB_TIMELINE: { at: number; message: string }[] = [
  { at: 0, message: 'Değişiklikler okunuyor: main...feature/ai-refactor' },
  { at: 350, message: '20 dosya, 9 Java dosyası değişmiş' },
  { at: 800, message: 'Java dosyaları ayrıştırılıyor: 9/9' },
  { at: 1300, message: 'Repo indeksi: 412/1250 dosya' },
  { at: 1700, message: 'Repo indeksi: 1250/1250 dosya' },
  { at: 2100, message: 'Çağıranlar ve alt tipler çözülüyor' },
  { at: 2500, message: 'Risk, gruplar ve okuma planı hesaplanıyor' },
];
const JOB_DURATION_MS = 2800;

interface MockJob {
  id: string;
  started: number;
  startedAt: string;
  req: ReviewRequest;
  reviewId?: string;
}
const jobs = new Map<string, MockJob>();
let jobSeq = 0;

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

export const mockApi: ReviewApi & { createReviewNow(req: ReviewRequest): Promise<ReviewModel> } = {
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
  async createReview(req: ReviewRequest, signal?: AbortSignal, onProgress?: ProgressFn): Promise<ReviewModel> {
    await delay(2600, signal);
    await simulateDownload(onProgress, signal);
    return mockApi.createReviewNow(req);
  },
  async createReviewNow(req: ReviewRequest): Promise<ReviewModel> {
    const { sampleReview } = await sample();
    deleted.delete(sampleReview.id);
    const title = titleFor(req);
    const model: ReviewModel = title ? { ...sampleReview, source: { ...sampleReview.source, title } } : sampleReview;
    if (!created.some((r) => r.id === model.id)) created.push(model);
    return model;
  },
  async createJob(req: ReviewRequest, signal?: AbortSignal): Promise<ReviewJob> {
    await delay(60, signal);
    if (req.kind === 'git' && req.base.trim() === 'yok') {
      throw new ApiRequestError(`Ref bulunamadı: ${req.base}`, { kind: 'http', status: 400, endpoint: 'mock:/api/jobs', field: 'base', fromServerBody: true });
    }
    jobSeq += 1;
    const job: MockJob = { id: `job-${jobSeq}`, started: Date.now(), startedAt: new Date().toISOString(), req };
    jobs.set(job.id, job);
    return mockApi.getJob(job.id, signal);
  },
  async getJob(id: string, signal?: AbortSignal): Promise<ReviewJob> {
    await delay(40, signal);
    const job = jobs.get(id);
    if (!job) throw new ApiRequestError(`İş bulunamadı: ${id}`, { kind: 'http', status: 404, endpoint: `mock:/api/jobs/${id}`, fromServerBody: true });
    const elapsed = Date.now() - job.started;
    const progress = JOB_TIMELINE.filter((p) => p.at <= elapsed).map((p) => ({ at: new Date(job.started + p.at).toISOString(), message: p.message }));
    if (elapsed < JOB_DURATION_MS) return { id, status: 'running', startedAt: job.startedAt, progress };
    if (!job.reviewId) {
      const model = await mockApi.createReviewNow(job.req);
      job.reviewId = model.id;
    }
    return { id, status: 'done', startedAt: job.startedAt, progress, reviewId: job.reviewId };
  },
  async deleteReview(id: string): Promise<void> {
    await delay(60);
    deleted.add(id);
    const i = created.findIndex((r) => r.id === id);
    if (i >= 0) created.splice(i, 1);
  },
  async listReviews(): Promise<ReviewListItem[]> {
    await delay(60);
    const { sampleReview } = await sample();
    const items: ReviewListItem[] = [sampleReview].filter((r) => !deleted.has(r.id)).map((r) => ({ id: r.id, title: r.source.title, createdAt: r.createdAt, kind: r.source.kind, files: r.files.length }));
    if (!deleted.has(LARGE_ID)) items.push({ id: LARGE_ID, title: 'v31.0...v33.0 (sentetik büyük review)', createdAt: '2026-10-03T00:00:00.000Z', kind: 'git', files: 2000 });
    return items;
  },
  async getReview(id: string, opts?: LoadOptions): Promise<ReviewModel> {
    await delay(120, opts?.signal);
    if (id === LARGE_ID && !deleted.has(LARGE_ID)) {
      await simulateDownload(opts?.onProgress, opts?.signal);
      return large();
    }
    const { sampleReview, SAMPLE_REVIEW_ID } = await sample();
    if (id === SAMPLE_REVIEW_ID && !deleted.has(id)) return created.find((r) => r.id === id) ?? sampleReview;
    throw new ApiRequestError(`Review bulunamadı: ${id}`, { kind: 'http', status: 404, endpoint: `mock:/api/reviews/${id}`, fromServerBody: true });
  },
  async getFile(_id: string, path: string, side: FileSide): Promise<FileContentResponse> {
    await delay(90);
    const { sampleFiles } = await sample();
    return { path, side, content: sampleFiles[path]?.[side] ?? null };
  },
  async getOutline(_id: string, path: string, side: FileSide, signal?: AbortSignal): Promise<FileOutline> {
    await delay(70, signal);
    const { mockOutline } = await import('../mock/outline');
    const outline = mockOutline(path, side);
    if (!outline) throw new ApiRequestError(`Dosya bulunamadı: ${path}`, { kind: 'http', status: 404, endpoint: `mock:/outline?path=${path}`, fromServerBody: true });
    return outline;
  },
  async locate(_id: string, symbolId: string, signal?: AbortSignal): Promise<SymbolLocation> {
    await delay(50, signal);
    const { mockLocate } = await import('../mock/outline');
    const loc = mockLocate(symbolId);
    if (!loc) throw new ApiRequestError(`Sembol bulunamadı: ${symbolId}`, { kind: 'http', status: 404, endpoint: `mock:/locate?id=${symbolId}`, fromServerBody: true });
    return loc;
  },
  async listFs(path: string, hidden: boolean, signal?: AbortSignal): Promise<FsListing> {
    await delay(90, signal);
    const { mockListFs } = await import('../mock/fsTree');
    return mockListFs(path, hidden);
  },
};

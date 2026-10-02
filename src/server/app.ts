/**
 * Reviewist HTTP API (Hono). Uç noktalar `src/shared/types.ts` sonundaki listededir.
 * Güvenlik: yalnız loopback'e bağlanılır; Host başlığı (DNS rebinding) ve POST/DELETE'te Origin denetlenir.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type {
  ApiError,
  AppConfig,
  ChangeSet,
  ReviewJob,
  ReviewListItem,
  ReviewModel,
  ReviewRequest,
} from '../shared/types.js';
import { createChangeSet, parseReviewRequest, type CreateChangeSetOptions } from '../sources/index.js';
import { sanitizeRepoRelPath, type ManagedChangeSet } from '../sources/common.js';
import { isSourceError, shortMessage, SourceError } from '../sources/errors.js';
import { getGitRefs } from '../sources/git.js';
import { DEFAULT_TOKEN_ENVS, resolveGithubToken } from '../sources/github.js';
import { AnalysisQueue, JobManager, toApiError } from './jobs.js';

/** `src/core/buildReview.ts` sözleşmesi (docs/CONTRACT.md). */
export interface BuildReviewOptions {
  id?: string;
  maxIndexFiles?: number;
  onProgress?: (msg: string) => void;
}
export type BuildReviewFn = (cs: ChangeSet, opts?: BuildReviewOptions) => Promise<ReviewModel>;

export type CreateChangeSetFn = (req: ReviewRequest, opts: CreateChangeSetOptions) => Promise<ManagedChangeSet>;

export interface CreateAppOptions {
  /** CLI'nin açıldığı depo; istekteki göreli yollar buna göre çözülür, refs ucu varsayılanı. */
  defaultRepoPath?: string;
  /** Derlenmiş arayüz (dist/web). Verilirse statik servis + SPA fallback. */
  staticDir?: string;
  /** Analiz motoru; verilmezse `../core/buildReview.js` dinamik yüklenir. */
  buildReview?: BuildReviewFn;
  /** Test için kaynak üreticisi; varsayılan `createChangeSet`. */
  createChangeSet?: CreateChangeSetFn;
  version?: string;
  /** GitHub token'ı için ortam değişkeni adları (varsayılan GITHUB_TOKEN, GH_TOKEN). */
  tokenEnvNames?: readonly string[];
  /** Bellekte tutulacak en fazla review (LRU). Varsayılan 20. */
  maxReviews?: number;
  /** Aynı anda en fazla kaç analiz (fazlası kuyrukta bekler). Varsayılan 2. */
  maxConcurrentAnalyses?: number;
  /** Biten işlerin tutulma süresi (ms). Varsayılan 10 dk. */
  jobTtlMs?: number;
  /** Test için saat (iş süresi dolumu). */
  now?: () => number;
  /** POST Origin denetiminde ek izinli portlar (varsayılan: vite dev 5173). */
  devPorts?: number[];
  /** Her ilerleme mesajı (iş kaynaklıysa jobId ile). */
  onProgress?: (msg: string, jobId?: string) => void;
}

export interface ReviewistApp {
  app: Hono;
  /** Doğrular, ChangeSet üretir, analiz eder ve depoya ekler (senkron uç ve testler için). */
  createReview(body: unknown): Promise<ReviewModel>;
  /** Doğrular (hatada SourceError fırlatır) ve analizi arka plan işi olarak başlatır. */
  startJob(body: unknown): ReviewJob;
  /** İş bitene kadar bekler; bilinmeyen işte undefined. */
  waitForJob(id: string): Promise<ReviewJob | undefined>;
  /** Depodaki review modeli (CLI özet için). */
  getReview(id: string): ReviewModel | undefined;
  setInitialReviewId(id: string | undefined): void;
  /** Tüm ChangeSet'leri dispose eder; süreçler kapandığında çözülür. */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Review deposu (LRU + aktif istek sayacı)
// ---------------------------------------------------------------------------

interface StoredReview {
  model: ReviewModel;
  cs: ManagedChangeSet;
  /** ChangeSet'i kullanan süren istek sayısı (ör. file ucu). */
  active: number;
  /** Depodan çıkarıldı (LRU/DELETE); sayaç sıfırlanınca dispose edilir. */
  retired: boolean;
  disposed: boolean;
}

/** Süren bir isteğin ChangeSet kullanım hakkı; iş bitince `release()` çağrılmalı. */
export interface ReviewLease {
  model: ReviewModel;
  cs: ManagedChangeSet;
  release(): void;
}

export class ReviewStore {
  private readonly map = new Map<string, StoredReview>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly max: number) {}

  add(model: ReviewModel, cs: ManagedChangeSet): void {
    const old = this.map.get(model.id);
    if (old) {
      this.map.delete(model.id);
      if (old.cs !== cs) this.retire(old);
    }
    this.map.set(model.id, { model, cs, active: 0, retired: false, disposed: false });
    while (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const e = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (e) this.retire(e);
    }
  }

  get(id: string): StoredReview | undefined {
    const e = this.map.get(id);
    if (!e) return undefined;
    this.map.delete(id);
    this.map.set(id, e);
    return e;
  }

  /**
   * Review'u ChangeSet kullanımı için kiralar: kira sürerken review LRU'dan düşse ya da silinse bile
   * ChangeSet dispose edilmez; son kira bırakılınca edilir.
   */
  acquire(id: string): ReviewLease | undefined {
    const e = this.get(id);
    if (!e) return undefined;
    e.active++;
    let released = false;
    return {
      model: e.model,
      cs: e.cs,
      release: () => {
        if (released) return;
        released = true;
        e.active--;
        if (e.retired && e.active === 0) this.disposeEntry(e);
      },
    };
  }

  /** Review'u kaldırır (DELETE). Kullanımdaysa dispose son kira bırakılınca yapılır. */
  remove(id: string): boolean {
    const e = this.map.get(id);
    if (!e) return false;
    this.map.delete(id);
    this.retire(e);
    return true;
  }

  list(): ReviewListItem[] {
    return [...this.map.values()]
      .map(({ model }) => ({
        id: model.id,
        title: model.source.title,
        createdAt: model.createdAt,
        kind: model.source.kind,
        files: model.files.length,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get size(): number {
    return this.map.size;
  }

  /** Kapanış: kira durumuna bakılmaksızın hepsini dispose eder ve bekleyen dispose'ları bekler. */
  async disposeAll(): Promise<void> {
    const all = [...this.map.values()];
    this.map.clear();
    for (const e of all) this.disposeEntry(e);
    await Promise.all([...this.pending]);
  }

  private retire(e: StoredReview): void {
    e.retired = true;
    if (e.active === 0) this.disposeEntry(e);
  }

  private disposeEntry(e: StoredReview): void {
    if (e.disposed) return;
    e.disposed = true;
    const p = safeDispose(e.cs);
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }
}

function safeDispose(cs: ManagedChangeSet): Promise<void> {
  const warn = (err: unknown): void => console.warn(`[reviewist] ChangeSet kapatılamadı: ${shortMessage(err, 120)}`);
  try {
    return Promise.resolve(cs.dispose()).catch(warn);
  } catch (err) {
    warn(err);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Güvenlik yardımcıları
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseHost(host: string): { hostname: string; port: string } | undefined {
  try {
    const u = new URL(`http://${host}`);
    return { hostname: u.hostname.toLowerCase(), port: u.port };
  } catch {
    return undefined;
  }
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = parseHost(host);
  return h !== undefined && LOOPBACK_HOSTS.has(h.hostname);
}

export function isAllowedOrigin(origin: string, host: string, devPorts: number[]): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (o.protocol !== 'http:' || !LOOPBACK_HOSTS.has(o.hostname.toLowerCase())) return false;
  const h = parseHost(host);
  if (!h) return false;
  if (o.port === h.port) return true; // aynı origin (localhost ↔ 127.0.0.1 farkı serbest)
  return devPorts.some((p) => String(p) === o.port);
}

function apiError(c: Context, status: number, error: string, detail?: string, field?: string): Response {
  const body: ApiError = { error };
  if (detail) body.detail = detail;
  if (field) body.field = field;
  return c.json(body, status as ContentfulStatusCode);
}

// ---------------------------------------------------------------------------
// buildReview yükleyici
// ---------------------------------------------------------------------------

function isBuildReviewModule(mod: unknown): mod is { buildReview: BuildReviewFn } {
  return typeof mod === 'object' && mod !== null && 'buildReview' in mod && typeof mod.buildReview === 'function';
}

let defaultBuildReview: Promise<BuildReviewFn> | undefined;

/** A2'nin motorunu derleme bağımlılığı olmadan yükler (dosya yoksa anlamlı hata). */
async function loadDefaultBuildReview(): Promise<BuildReviewFn> {
  defaultBuildReview ??= (async () => {
    const specifier = '../core/buildReview.js';
    let mod: unknown;
    try {
      mod = await import(specifier);
    } catch (err) {
      defaultBuildReview = undefined;
      throw new SourceError('Analiz motoru yüklenemedi (src/core/buildReview).', {
        status: 500,
        code: 'ENGINE',
        detail: shortMessage(err, 200),
      });
    }
    if (!isBuildReviewModule(mod)) {
      defaultBuildReview = undefined;
      throw new SourceError('Analiz motoru beklenen buildReview işlevini dışa açmıyor.', { status: 500, code: 'ENGINE' });
    }
    return mod.buildReview;
  })();
  return await defaultBuildReview;
}

// ---------------------------------------------------------------------------
// createApp
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 60 * 1024 * 1024;
const REVIEW_NOT_FOUND = 'Review bulunamadı. Sunucu yeniden başlatılmış ya da review bellekten düşmüş olabilir.';

function newReviewId(): string {
  return `r-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/** İstekteki göreli depo yollarını defaultRepoPath'e (yoksa cwd) göre mutlaklaştırır. */
function absolutizePaths(req: ReviewRequest, baseDir: string): ReviewRequest {
  switch (req.kind) {
    case 'git':
    case 'worktree':
      return { ...req, repoPath: resolve(baseDir, req.repoPath) };
    case 'github':
      return req.localRepoPath ? { ...req, localRepoPath: resolve(baseDir, req.localRepoPath) } : req;
    case 'patch':
      return req.repoPath ? { ...req, repoPath: resolve(baseDir, req.repoPath) } : req;
  }
}

/** JSON gövdeyi okur; geçersizse 400 SourceError. */
async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    throw new SourceError('İstek gövdesi geçerli JSON değil.', { status: 400, code: 'VALIDATION' });
  }
}

const jsonBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => apiError(c, 413, 'İstek gövdesi çok büyük (en fazla 60 MB).'),
});

export function createApp(opts: CreateAppOptions = {}): ReviewistApp {
  const app = new Hono();
  const store = new ReviewStore(opts.maxReviews ?? 20);
  const queue = new AnalysisQueue(Math.max(1, opts.maxConcurrentAnalyses ?? 2));
  const jobs = new JobManager({ ttlMs: opts.jobTtlMs, now: opts.now, onProgress: opts.onProgress });
  const tokenEnvNames = opts.tokenEnvNames ?? DEFAULT_TOKEN_ENVS;
  const devPorts = opts.devPorts ?? [5173];
  const makeChangeSet: CreateChangeSetFn = opts.createChangeSet ?? createChangeSet;
  let initialReviewId: string | undefined;
  let closed = false;

  const validate = (body: unknown): ReviewRequest =>
    absolutizePaths(parseReviewRequest(body), opts.defaultRepoPath ?? process.cwd());

  /** Doğrulanmış isteği kuyruk sınırı altında analiz eder ve depoya ekler. */
  const analyze = async (req: ReviewRequest, progress: (msg: string) => void): Promise<ReviewModel> =>
    await queue.run(
      async () => {
        const cs = await makeChangeSet(req, { tokenEnvNames, onProgress: progress });
        let model: ReviewModel;
        try {
          const build = opts.buildReview ?? (await loadDefaultBuildReview());
          progress('Analiz başlıyor');
          model = await build(cs, { id: newReviewId(), onProgress: progress });
        } catch (err) {
          void safeDispose(cs);
          throw err;
        }
        if (closed) {
          void safeDispose(cs);
          throw new SourceError('Sunucu kapanıyor; analiz sonucu saklanmadı.', { status: 503, code: 'ENGINE' });
        }
        // Kaynak uyarıları (analiz sırasında eklenenler dahil) modele eklenir.
        const merged = [...cs.warnings, ...(model.warnings ?? [])];
        model.warnings = [...new Set(merged)];
        store.add(model, cs);
        return model;
      },
      (position) => progress(`Kuyrukta bekleniyor (sıra: ${position}; aynı anda en fazla ${opts.maxConcurrentAnalyses ?? 2} analiz)`),
    );

  const createReview = async (body: unknown): Promise<ReviewModel> => {
    const req = validate(body);
    return await analyze(req, (msg) => opts.onProgress?.(msg));
  };

  const startJob = (body: unknown): ReviewJob => {
    const req = validate(body); // senkron doğrulama: hata çağırana (400) gider
    return jobs.start(async (progress) => (await analyze(req, progress)).id);
  };

  // --- güvenlik --------------------------------------------------------------
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    if (!isLoopbackHost(host)) {
      return apiError(c, 403, 'İzin verilmeyen Host başlığı. Reviewist yalnızca localhost üzerinden kullanılabilir.', `host: ${host}`);
    }
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const origin = c.req.header('origin');
      if (origin !== undefined && !isAllowedOrigin(origin, host, devPorts)) {
        return apiError(c, 403, 'İzin verilmeyen Origin. İstekler yalnızca Reviewist arayüzünden gönderilebilir.', `origin: ${origin}`);
      }
    }
    await next();
  });

  // --- API -----------------------------------------------------------------
  app.get('/api/config', (c) => {
    const cfg: AppConfig = {
      version: opts.version ?? '0.0.0',
      githubTokenConfigured: resolveGithubToken(undefined, tokenEnvNames) !== undefined,
    };
    if (opts.defaultRepoPath) cfg.defaultRepoPath = opts.defaultRepoPath;
    if (initialReviewId && store.get(initialReviewId)) cfg.initialReviewId = initialReviewId;
    return c.json(cfg);
  });

  app.get('/api/git/refs', async (c) => {
    const q = c.req.query('repoPath')?.trim();
    const repoPath = q ? resolve(opts.defaultRepoPath ?? process.cwd(), q) : opts.defaultRepoPath;
    if (!repoPath) {
      return apiError(c, 400, 'repoPath parametresi gerekli (sunucu bir depo içinde başlatılmadı).', undefined, 'repoPath');
    }
    return c.json(await getGitRefs(repoPath));
  });

  // Senkron (geri uyumluluk): analiz bitince ReviewModel döner.
  app.post('/api/reviews', jsonBodyLimit, async (c) => c.json(await createReview(await readJsonBody(c))));

  // Arka plan işi: doğrulama hatası senkron 400, aksi halde 202 + ReviewJob.
  app.post('/api/jobs', jsonBodyLimit, async (c) => c.json(startJob(await readJsonBody(c)), 202));

  app.get('/api/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return apiError(c, 404, 'İş bulunamadı. Biten işler 10 dakika sonra silinir ya da sunucu yeniden başlatılmış olabilir.');
    return c.json(job);
  });

  app.get('/api/reviews', (c) => c.json(store.list()));

  app.get('/api/reviews/:id', (c) => {
    const e = store.get(c.req.param('id'));
    if (!e) return apiError(c, 404, REVIEW_NOT_FOUND);
    return c.json(e.model);
  });

  app.delete('/api/reviews/:id', (c) => {
    const id = c.req.param('id');
    if (!store.remove(id)) return apiError(c, 404, REVIEW_NOT_FOUND);
    if (initialReviewId === id) initialReviewId = undefined;
    return c.json({ ok: true as const });
  });

  app.get('/api/reviews/:id/file', async (c) => {
    const side = c.req.query('side') ?? 'new';
    if (side !== 'old' && side !== 'new') return apiError(c, 400, "side parametresi 'old' ya da 'new' olmalı.", undefined, 'side');
    const rawPath = c.req.query('path');
    if (!rawPath) return apiError(c, 400, 'path parametresi gerekli.', undefined, 'path');
    const path = sanitizeRepoRelPath(rawPath);
    if (path === undefined) {
      return apiError(c, 400, "Geçersiz dosya yolu: depo köküne göre göreli olmalı; '..' ve mutlak yol kullanılamaz.", undefined, 'path');
    }
    const lease = store.acquire(c.req.param('id'));
    if (!lease) return apiError(c, 404, REVIEW_NOT_FOUND);
    try {
      const content = await lease.cs.readFile(side, path);
      return c.json({ path, side, content: content ?? null });
    } finally {
      lease.release();
    }
  });

  app.all('/api/*', (c) => apiError(c, 404, 'API uç noktası bulunamadı.', `${c.req.method} ${c.req.path}`));

  // --- statik arayüz ---------------------------------------------------------
  const staticDir = opts.staticDir;
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use('/*', serveStatic({ root: staticDir }));
    const indexPath = join(staticDir, 'index.html');
    app.get('*', async (c) => c.html(await readFile(indexPath, 'utf8')));
  }

  app.notFound((c) => apiError(c, 404, 'Bulunamadı.', c.req.path));

  app.onError((err, c) => {
    const { status, body } = toApiError(err);
    if (!isSourceError(err)) console.error(`[reviewist] ${c.req.method} ${c.req.path}: ${shortMessage(err, 300)}`);
    return c.json(body, status as ContentfulStatusCode);
  });

  return {
    app,
    createReview,
    startJob,
    waitForJob: (id) => jobs.wait(id),
    getReview: (id) => store.get(id)?.model,
    setInitialReviewId(id) {
      initialReviewId = id;
    },
    dispose() {
      closed = true;
      return store.disposeAll();
    },
  };
}

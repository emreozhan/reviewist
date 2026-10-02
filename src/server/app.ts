/**
 * Reviewist HTTP API (Hono). Uç noktalar `src/shared/types.ts` sonundaki listededir.
 * Güvenlik: yalnız loopback'e bağlanılır; Host başlığı (DNS rebinding) ve POST'ta Origin denetlenir.
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
  ReviewListItem,
  ReviewModel,
  ReviewRequest,
} from '../shared/types.js';
import { createChangeSet, parseReviewRequest, type CreateChangeSetOptions } from '../sources/index.js';
import type { ManagedChangeSet } from '../sources/common.js';
import { isSourceError, shortMessage, SourceError } from '../sources/errors.js';
import { getGitRefs } from '../sources/git.js';
import { DEFAULT_TOKEN_ENVS, resolveGithubToken } from '../sources/github.js';

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
  /** POST Origin denetiminde ek izinli portlar (varsayılan: vite dev 5173). */
  devPorts?: number[];
  onProgress?: (msg: string) => void;
}

export interface ReviewistApp {
  app: Hono;
  /** Doğrular, ChangeSet üretir, analiz eder ve depoya ekler (CLI ilk review için kullanır). */
  createReview(body: unknown): Promise<ReviewModel>;
  setInitialReviewId(id: string | undefined): void;
  /** Tüm ChangeSet'leri dispose eder; süreçler kapandığında çözülür. */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Review deposu (LRU)
// ---------------------------------------------------------------------------

interface StoredReview {
  model: ReviewModel;
  cs: ManagedChangeSet;
}

export class ReviewStore {
  private readonly map = new Map<string, StoredReview>();

  constructor(private readonly max: number) {}

  add(model: ReviewModel, cs: ManagedChangeSet): void {
    const old = this.map.get(model.id);
    if (old) {
      this.map.delete(model.id);
      if (old.cs !== cs) void safeDispose(old.cs);
    }
    this.map.set(model.id, { model, cs });
    while (this.map.size > this.max) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      const e = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (e) void safeDispose(e.cs);
    }
  }

  get(id: string): StoredReview | undefined {
    const e = this.map.get(id);
    if (!e) return undefined;
    this.map.delete(id);
    this.map.set(id, e);
    return e;
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

  disposeAll(): Promise<void> {
    const all = [...this.map.values()].map((e) => safeDispose(e.cs));
    this.map.clear();
    return Promise.all(all).then(() => undefined);
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

function apiError(c: Context, status: number, error: string, detail?: string): Response {
  const body: ApiError = detail ? { error, detail } : { error };
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

export function createApp(opts: CreateAppOptions = {}): ReviewistApp {
  const app = new Hono();
  const store = new ReviewStore(opts.maxReviews ?? 20);
  const tokenEnvNames = opts.tokenEnvNames ?? DEFAULT_TOKEN_ENVS;
  const devPorts = opts.devPorts ?? [5173];
  const makeChangeSet: CreateChangeSetFn = opts.createChangeSet ?? createChangeSet;
  const progress = opts.onProgress ?? (() => undefined);
  let initialReviewId: string | undefined;

  const createReview = async (body: unknown): Promise<ReviewModel> => {
    const req = absolutizePaths(parseReviewRequest(body), opts.defaultRepoPath ?? process.cwd());
    const cs = await makeChangeSet(req, { tokenEnvNames, onProgress: progress });
    let model: ReviewModel;
    try {
      const build = opts.buildReview ?? (await loadDefaultBuildReview());
      model = await build(cs, { id: newReviewId(), onProgress: progress });
    } catch (err) {
      void safeDispose(cs);
      throw err;
    }
    // Kaynak uyarıları (analiz sırasında eklenenler dahil) modele eklenir.
    const merged = [...cs.warnings, ...(model.warnings ?? [])];
    model.warnings = [...new Set(merged)];
    store.add(model, cs);
    return model;
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
    if (!repoPath) return apiError(c, 400, 'repoPath parametresi gerekli (sunucu bir depo içinde başlatılmadı).');
    return c.json(await getGitRefs(repoPath));
  });

  app.post(
    '/api/reviews',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => apiError(c, 413, 'İstek gövdesi çok büyük (en fazla 60 MB).'),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return apiError(c, 400, 'İstek gövdesi geçerli JSON değil.');
      }
      return c.json(await createReview(body));
    },
  );

  app.get('/api/reviews', (c) => c.json(store.list()));

  app.get('/api/reviews/:id', (c) => {
    const e = store.get(c.req.param('id'));
    if (!e) return apiError(c, 404, 'Review bulunamadı. Sunucu yeniden başlatılmış ya da review bellekten düşmüş olabilir.');
    return c.json(e.model);
  });

  app.get('/api/reviews/:id/file', async (c) => {
    const e = store.get(c.req.param('id'));
    if (!e) return apiError(c, 404, 'Review bulunamadı. Sunucu yeniden başlatılmış ya da review bellekten düşmüş olabilir.');
    const side = c.req.query('side') ?? 'new';
    if (side !== 'old' && side !== 'new') return apiError(c, 400, "side parametresi 'old' ya da 'new' olmalı.");
    const path = c.req.query('path');
    if (!path) return apiError(c, 400, 'path parametresi gerekli.');
    const content = await e.cs.readFile(side, path);
    return c.json({ path, side, content: content ?? null });
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
    if (isSourceError(err)) return apiError(c, err.status, err.message, err.detail);
    console.error(`[reviewist] ${c.req.method} ${c.req.path}: ${shortMessage(err, 300)}`);
    return apiError(c, 500, 'Beklenmeyen sunucu hatası.', shortMessage(err, 300));
  });

  return {
    app,
    createReview,
    setInitialReviewId(id) {
      initialReviewId = id;
    },
    dispose() {
      return store.disposeAll();
    },
  };
}

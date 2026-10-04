import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, AppConfig, ChangeSet, GitRefs, ReviewJob, ReviewListItem, ReviewModel } from '../shared/types.js';
import type { ManagedChangeSet } from '../sources/common.js';
import { createApp, isAllowedOrigin, isLoopbackHost, type BuildReviewFn, type ReviewistApp } from './app.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let repo: string;
const apps: ReviewistApp[] = [];

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'reviewist-srv-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/A.java'), 'class A {}\n');
  writeFileSync(join(repo, 'src/C.java'), 'class C { /* diff dışı */ }\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'c1');
  git(repo, 'checkout', '-q', '-b', 'feature');
  writeFileSync(join(repo, 'src/A.java'), 'class A { int x; }\n');
  writeFileSync(join(repo, 'src/B.java'), 'class B {}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'c2');
});

afterEach(async () => {
  while (apps.length) await apps.pop()?.dispose();
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

beforeEach(() => {
  vi.stubEnv('GITHUB_TOKEN', '');
  vi.stubEnv('GH_TOKEN', '');
});

const fakeBuildReview: BuildReviewFn = async (cs: ChangeSet, opts) => {
  const java = await cs.listFiles('new', '.java');
  return {
    id: opts?.id ?? 'x',
    createdAt: new Date().toISOString(),
    source: cs.info,
    summary: {
      files: cs.files.length,
      javaFiles: java.length,
      testFiles: 0,
      additions: 0,
      deletions: 0,
      typesChanged: 0,
      membersChanged: 0,
      publicApiChanges: 0,
      cosmeticFiles: 0,
      highRiskItems: 0,
      impactedOutsideDiff: 0,
      untestedChanges: 0,
    },
    files: cs.files.map((f, i) => ({
      id: f.path,
      path: f.path,
      status: f.status,
      language: 'java',
      binary: f.binary,
      additions: f.additions,
      deletions: f.deletions,
      hunks: f.hunks,
      layer: 'other',
      isTest: false,
      cosmeticOnly: false,
      typeIds: [],
      relatedTestFiles: [],
      risk: { score: 0, level: 'low', reasons: [] },
      reviewOrder: i + 1,
    })),
    types: [],
    graph: { nodes: [], edges: [] },
    groups: [],
    reviewPlan: [],
    findings: [],
    warnings: ['motor uyarısı'],
  };
};

function make(opts: Parameters<typeof createApp>[0] = {}): ReviewistApp {
  const a = createApp({ defaultRepoPath: repo, buildReview: fakeBuildReview, version: '9.9.9', ...opts });
  apps.push(a);
  return a;
}

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const post = (payload: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof payload === 'string' ? payload : JSON.stringify(payload),
});

describe('GET /api/config ve /api/git/refs', () => {
  it('config', async () => {
    const { app } = make();
    const res = await app.request('/api/config');
    expect(res.status).toBe(200);
    expect(await body<AppConfig>(res)).toEqual({ version: '9.9.9', defaultRepoPath: repo, githubTokenConfigured: false });
    vi.stubEnv('GH_TOKEN', 'x');
    expect((await body<AppConfig>(await app.request('/api/config'))).githubTokenConfigured).toBe(true);
  });

  it('refs (varsayılan depo ve sorgu parametresi)', async () => {
    const { app } = make();
    const refs = await body<GitRefs>(await app.request('/api/git/refs'));
    expect(refs.branches).toEqual(['feature', 'main']);
    expect(refs.currentBranch).toBe('feature');
    expect(refs.defaultBase).toBe('main');
    const q = await app.request(`/api/git/refs?repoPath=${encodeURIComponent(repo)}`);
    expect(q.status).toBe(200);
  });

  it('refs ve analiz istekleri ağ yolunu (UNC) reddeder', async () => {
    const { app } = make();
    const refs = await app.request(`/api/git/refs?repoPath=${encodeURIComponent('\\\\evil\\share')}`);
    expect(refs.status).toBe(400);
    expect((await body<ApiError>(refs)).field).toBe('repoPath');
    const job = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'git', repoPath: '//evil/share', base: 'main', head: 'feature' }),
    });
    expect(job.status).toBe(400);
    expect((await body<ApiError>(job)).field).toBe('repoPath');
  });

  it('refs: depo verilmediyse 400, depo değilse 400 Türkçe', async () => {
    const { app } = createApp({ buildReview: fakeBuildReview });
    const res = await app.request('/api/git/refs');
    expect(res.status).toBe(400);
    expect((await body<ApiError>(res)).error).toContain('repoPath');
    const notRepo = mkdtempSync(join(tmpdir(), 'reviewist-srv-norepo-'));
    try {
      const r2 = await app.request(`/api/git/refs?repoPath=${encodeURIComponent(notRepo)}`);
      expect(r2.status).toBe(400);
      expect((await body<ApiError>(r2)).error).toContain('git deposu değil');
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });
});

describe('POST /api/reviews ve review uçları', () => {
  it('git review oluşturur; liste, ayrıntı ve dosya uçları çalışır', async () => {
    const reviewist = make();
    const { app } = reviewist;
    const res = await app.request('/api/reviews', post({ kind: 'git', repoPath: repo, base: 'main', head: 'feature' }));
    expect(res.status).toBe(200);
    const model = await body<ReviewModel>(res);
    expect(model.source).toMatchObject({ kind: 'git', title: 'main...feature' });
    expect(model.files.map((f) => f.path).sort()).toEqual(['src/A.java', 'src/B.java']);
    expect(model.summary.javaFiles).toBe(3); // repo geneli liste: A, B, C
    expect(model.warnings).toContain('motor uyarısı');

    const list = await body<ReviewListItem[]>(await app.request('/api/reviews'));
    expect(list).toEqual([{ id: model.id, title: 'main...feature', createdAt: model.createdAt, kind: 'git', files: 2 }]);
    expect((await body<ReviewModel>(await app.request(`/api/reviews/${model.id}`))).id).toBe(model.id);

    const fNew = await body<{ content: string | null }>(await app.request(`/api/reviews/${model.id}/file?path=src/A.java&side=new`));
    expect(fNew).toEqual({ path: 'src/A.java', side: 'new', content: 'class A { int x; }\n' });
    const fOld = await body<{ content: string | null }>(await app.request(`/api/reviews/${model.id}/file?path=src/A.java&side=old`));
    expect(fOld.content).toBe('class A {}\n');
    const fNone = await body<{ content: string | null }>(await app.request(`/api/reviews/${model.id}/file?path=src/B.java&side=old`));
    expect(fNone.content).toBeNull();

    expect((await app.request(`/api/reviews/${model.id}/file?path=src/A.java&side=x`)).status).toBe(400);
    expect((await app.request(`/api/reviews/${model.id}/file?side=new`)).status).toBe(400);
    const missing = await app.request('/api/reviews/yok/file?path=a&side=new');
    expect(missing.status).toBe(404);
    expect((await body<ApiError>(missing)).error).toContain('Review bulunamadı');
    expect((await app.request('/api/reviews/yok')).status).toBe(404);

    // CLI yolu: createReview + initialReviewId
    const m2 = await reviewist.createReview({ kind: 'worktree', repoPath: repo });
    reviewist.setInitialReviewId(m2.id);
    expect((await body<AppConfig>(await app.request('/api/config'))).initialReviewId).toBe(m2.id);
  });

  it('göreli repoPath defaultRepoPath\'e göre çözülür', async () => {
    const { app } = make();
    const res = await app.request('/api/reviews', post({ kind: 'git', repoPath: '.', base: 'main', head: 'feature' }));
    expect(res.status).toBe(200);
  });

  it('doğrulama hataları 400 ve Türkçe', async () => {
    const { app } = make();
    const r1 = await app.request('/api/reviews', post({ kind: 'git', repoPath: repo, base: '' }));
    expect(r1.status).toBe(400);
    const e1 = await body<ApiError>(r1);
    expect(e1.error).toContain('Geçersiz review isteği');
    expect(e1.error).toContain('base: base boş olamaz');
    expect(e1.error).toContain('head');

    const r2 = await app.request('/api/reviews', post({ kind: 'svn' }));
    expect(r2.status).toBe(400);
    expect((await body<ApiError>(r2)).error).toContain("kind alanı 'git'");

    const r3 = await app.request('/api/reviews', post('{bozuk json'));
    expect(r3.status).toBe(400);
    expect((await body<ApiError>(r3)).error).toContain('geçerli JSON değil');

    const r4 = await app.request('/api/reviews', post([1, 2]));
    expect(r4.status).toBe(400);

    const r5 = await app.request('/api/reviews', post({ kind: 'git', repoPath: repo, base: 'main', head: 'yok-dal' }));
    expect(r5.status).toBe(400);
    const e5 = await body<ApiError>(r5);
    expect(e5.error).toContain("Git referansı bulunamadı (head): 'yok-dal'");
    expect(e5.field).toBe('head');

    expect(e1.field).toBe('base');
    const r6 = await app.request('/api/reviews', post({ kind: 'svn' }));
    expect((await body<ApiError>(r6)).field).toBe('kind');
    const notRepo = mkdtempSync(join(tmpdir(), 'reviewist-srv-norepo-'));
    try {
      const r7 = await app.request('/api/reviews', post({ kind: 'git', repoPath: notRepo, base: 'main', head: 'x' }));
      expect(r7.status).toBe(400);
      expect(await body<ApiError>(r7)).toMatchObject({ field: 'repoPath' });
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
    const r8 = await app.request('/api/reviews', post({ kind: 'github', url: 'https://github.com/a/b/issues/1' }));
    expect(r8.status).toBe(400);
    expect((await body<ApiError>(r8)).field).toBe('url');
  });

  it('kaynak uyarıları modele eklenir; LRU taşmasında ChangeSet dispose edilir', async () => {
    const disposed: string[] = [];
    const fakeCs = (name: string): ManagedChangeSet => ({
      info: { kind: 'patch', title: name, baseRef: 'a', headRef: 'b', stableKey: `patch:${name}` },
      files: [],
      warnings: [`kaynak uyarısı ${name}`],
      readFile: async () => `içerik ${name}`,
      listFiles: async () => [],
      dispose: () => {
        disposed.push(name);
      },
    });
    let n = 0;
    const { app } = make({
      maxReviews: 2,
      createChangeSet: async () => fakeCs(`cs${++n}`),
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const m = await body<ReviewModel>(await app.request('/api/reviews', post({ kind: 'patch', text: 'x' })));
      ids.push(m.id);
      expect(m.warnings[0]).toBe(`kaynak uyarısı cs${i + 1}`);
      expect(m.warnings).toContain('motor uyarısı');
    }
    expect(disposed).toEqual(['cs1']);
    expect((await app.request(`/api/reviews/${ids[0]}`)).status).toBe(404);
    expect((await app.request(`/api/reviews/${ids[2]}`)).status).toBe(200);
    expect((await body<ReviewListItem[]>(await app.request('/api/reviews'))).length).toBe(2);
  });

  it('buildReview hatası 500 ApiError (stack yok) ve ChangeSet dispose edilir', async () => {
    let disposed = false;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = make({
      buildReview: async () => {
        throw new Error('ayrıştırıcı patladı\n    at foo (bar.ts:1:1)');
      },
      createChangeSet: async () => ({
        info: { kind: 'patch', title: 't', baseRef: 'a', headRef: 'b', stableKey: 'patch:t' },
        files: [],
        warnings: [],
        readFile: async () => undefined,
        listFiles: async () => [],
        dispose: () => {
          disposed = true;
        },
      }),
    });
    const res = await app.request('/api/reviews', post({ kind: 'patch', text: 'x' }));
    expect(res.status).toBe(500);
    const e = await body<ApiError>(res);
    expect(e.error).toBe('Beklenmeyen sunucu hatası.');
    expect(e.detail).toContain('ayrıştırıcı patladı');
    expect(e.detail).not.toContain('\n');
    expect(disposed).toBe(true);
    errSpy.mockRestore();
  });

  it.skipIf(existsSync(fileURLToPath(new URL('../core/buildReview.ts', import.meta.url))))(
    'motor yoksa anlamlı 500 hatası',
    async () => {
      const a = createApp({ defaultRepoPath: repo });
      apps.push(a);
      const res = await a.app.request('/api/reviews', post({ kind: 'git', repoPath: repo, base: 'main', head: 'feature' }));
      expect(res.status).toBe(500);
      expect((await body<ApiError>(res)).error).toContain('Analiz motoru yüklenemedi');
    },
  );
});

// ---------------------------------------------------------------------------
// Yardımcılar: elle çözülen söz ve sahte ChangeSet
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeChangeSet(
  name: string,
  disposed: string[],
  readFile: ManagedChangeSet['readFile'] = async () => `içerik ${name}`,
): ManagedChangeSet {
  return {
    info: { kind: 'patch', title: name, baseRef: 'a', headRef: 'b', stableKey: `patch:${name}` },
    files: [],
    warnings: [],
    readFile,
    listFiles: async () => [],
    dispose: () => {
      disposed.push(name);
    },
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('POST /api/jobs ve GET /api/jobs/:id', () => {
  it('git işi: 202, ilerleme mesajları (kaynak + motor), done + reviewId', async () => {
    const progressSeen: string[] = [];
    const reviewist = make({ onProgress: (m) => progressSeen.push(m) });
    const { app } = reviewist;
    const res = await app.request('/api/jobs', post({ kind: 'git', repoPath: repo, base: 'main', head: 'feature' }));
    expect(res.status).toBe(202);
    const job = await body<ReviewJob>(res);
    expect(job).toMatchObject({ status: 'running' });
    expect(job.id).toMatch(/^j-/);
    expect(Number.isNaN(Date.parse(job.startedAt))).toBe(false);

    await reviewist.waitForJob(job.id);
    const done = await body<ReviewJob>(await app.request(`/api/jobs/${job.id}`));
    expect(done.status).toBe('done');
    expect(done.reviewId).toMatch(/^r-/);
    const msgs = done.progress.map((p) => p.message);
    expect(msgs).toContain('git diff alınıyor');
    expect(msgs).toContain('Analiz başlıyor');
    expect(msgs[msgs.length - 1]).toBe(`Review hazır: ${done.reviewId}`);
    expect(done.progress.every((p) => !Number.isNaN(Date.parse(p.at)))).toBe(true);
    expect(progressSeen).toContain('git diff alınıyor');

    const model = await body<ReviewModel>(await app.request(`/api/reviews/${done.reviewId}`));
    expect(model.source.stableKey).toMatch(/^git:.+:main\.\.\.feature:mergeBase$/);
  });

  it('doğrulama hatası senkron 400 + field; kaynak hatası işin error alanına (field ile)', async () => {
    const reviewist = make();
    const { app } = reviewist;
    const bad = await app.request('/api/jobs', post({ kind: 'github', url: '' }));
    expect(bad.status).toBe(400);
    expect(await body<ApiError>(bad)).toMatchObject({ field: 'url' });
    expect((await app.request('/api/jobs', post('{bozuk'))).status).toBe(400);

    const res = await app.request('/api/jobs', post({ kind: 'git', repoPath: repo, base: 'yok-taban', head: 'feature' }));
    expect(res.status).toBe(202);
    const job = await body<ReviewJob>(res);
    await reviewist.waitForJob(job.id);
    const failed = await body<ReviewJob>(await app.request(`/api/jobs/${job.id}`));
    expect(failed.status).toBe('error');
    expect(failed.reviewId).toBeUndefined();
    expect(failed.error).toMatchObject({ field: 'base' });
    expect(failed.error?.error).toContain('Git referansı bulunamadı (base)');
  });

  it('beklenmeyen motor hatası işte 500 tarzı ApiError olur; ChangeSet dispose edilir', async () => {
    const disposed: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reviewist = make({
      createChangeSet: async () => fakeChangeSet('cs', disposed),
      buildReview: async () => {
        throw new Error('motor çöktü');
      },
    });
    const job = reviewist.startJob({ kind: 'patch', text: 'x' });
    const done = await reviewist.waitForJob(job.id);
    expect(done?.status).toBe('error');
    expect(done?.error).toEqual({ error: 'Beklenmeyen sunucu hatası.', detail: 'motor çöktü' });
    expect(disposed).toEqual(['cs']);
    errSpy.mockRestore();
  });

  it('bilinmeyen iş 404', async () => {
    const { app } = make();
    const res = await app.request('/api/jobs/yok');
    expect(res.status).toBe(404);
    expect((await body<ApiError>(res)).error).toContain('İş bulunamadı');
  });

  it('aynı anda en fazla 2 analiz; üçüncü kuyrukta bekler (senkron uç da aynı kuyrukta)', async () => {
    const gates: Deferred<void>[] = [];
    let running = 0;
    let maxRunning = 0;
    const reviewist = make({
      createChangeSet: async () => fakeChangeSet('cs', []),
      buildReview: async (cs, opts) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        const g = deferred<void>();
        gates.push(g);
        await g.promise;
        running--;
        return await fakeBuildReview(cs, opts);
      },
    });
    const j1 = reviewist.startJob({ kind: 'patch', text: 'a' });
    const j2 = reviewist.startJob({ kind: 'patch', text: 'b' });
    const j3 = reviewist.startJob({ kind: 'patch', text: 'c' });
    const sync = reviewist.createReview({ kind: 'patch', text: 'd' });
    for (let i = 0; i < 5; i++) await tick();
    expect(gates.length).toBe(2);
    const queued = reviewist.app.request(`/api/jobs/${j3.id}`);
    const q = await body<ReviewJob>(await queued);
    expect(q.status).toBe('running');
    expect(q.progress.map((p) => p.message)).toContain('Kuyrukta bekleniyor (sıra: 1; aynı anda en fazla 2 analiz)');

    // Yuvalar boşaldıkça sıradakiler başlar.
    for (let n = 0; n < 4; n++) {
      while (gates.length <= n) await tick();
      gates[n]?.resolve();
    }
    const results = await Promise.all([j1, j2, j3].map((j) => reviewist.waitForJob(j.id)));
    expect(results.map((r) => r?.status)).toEqual(['done', 'done', 'done']);
    expect((await sync).id).toMatch(/^r-/);
    expect(maxRunning).toBe(2);
  });

  it('biten işler 10 dk sonra silinir', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const reviewist = make({
      now: () => now,
      createChangeSet: async () => fakeChangeSet('cs', []),
    });
    const job = reviewist.startJob({ kind: 'patch', text: 'x' });
    await reviewist.waitForJob(job.id);
    now += 9 * 60 * 1000;
    expect((await reviewist.app.request(`/api/jobs/${job.id}`)).status).toBe(200);
    now += 60 * 1000;
    expect((await reviewist.app.request(`/api/jobs/${job.id}`)).status).toBe(404);
  });
});

describe('DELETE /api/reviews/:id ve dispose yarışı', () => {
  it('DELETE dispose eder ve kaldırır; bilinmeyen id 404', async () => {
    const disposed: string[] = [];
    let n = 0;
    const reviewist = make({ createChangeSet: async () => fakeChangeSet(`cs${++n}`, disposed) });
    const { app } = reviewist;
    const m = await reviewist.createReview({ kind: 'patch', text: 'x' });
    reviewist.setInitialReviewId(m.id);
    const del = await app.request(`/api/reviews/${m.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await body<{ ok: boolean }>(del)).toEqual({ ok: true });
    expect(disposed).toEqual(['cs1']);
    expect((await app.request(`/api/reviews/${m.id}`)).status).toBe(404);
    expect((await body<AppConfig>(await app.request('/api/config'))).initialReviewId).toBeUndefined();
    expect((await app.request(`/api/reviews/${m.id}`, { method: 'DELETE' })).status).toBe(404);
    const evil = await app.request(`http://127.0.0.1:4317/api/reviews/${m.id}`, {
      method: 'DELETE',
      headers: { host: '127.0.0.1:4317', origin: 'http://evil.example' },
    });
    expect(evil.status).toBe(403);
  });

  it('file isteği sürerken review LRU\'dan düşerse 500 olmaz; dispose istek bitince yapılır', async () => {
    const disposed: string[] = [];
    const gate = deferred<void>();
    let closed = false;
    let n = 0;
    const reviewist = make({
      maxReviews: 1,
      createChangeSet: async () => {
        const name = `cs${++n}`;
        if (name !== 'cs1') return fakeChangeSet(name, disposed);
        const cs = fakeChangeSet(name, disposed, async () => {
          await gate.promise;
          if (closed) throw new Error('GitBlobReader kapatıldı.');
          return 'eski review içeriği';
        });
        cs.dispose = () => {
          closed = true;
          disposed.push(name);
        };
        return cs;
      },
    });
    const { app } = reviewist;
    const m1 = await reviewist.createReview({ kind: 'patch', text: 'x' });
    const pending = app.request(`/api/reviews/${m1.id}/file?path=src/A.java&side=new`);
    await tick();
    await reviewist.createReview({ kind: 'patch', text: 'y' }); // m1 LRU'dan düşer
    expect((await app.request(`/api/reviews/${m1.id}`)).status).toBe(404);
    expect(disposed).toEqual([]); // istek sürüyor: dispose ertelendi
    gate.resolve();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await body<{ content: string | null }>(res)).toEqual({ path: 'src/A.java', side: 'new', content: 'eski review içeriği' });
    expect(disposed).toEqual(['cs1']);
  });

  it('file isteği sürerken DELETE: istek tamamlanır, sonra dispose', async () => {
    const disposed: string[] = [];
    const gate = deferred<void>();
    const reviewist = make({
      createChangeSet: async () =>
        fakeChangeSet('cs', disposed, async () => {
          await gate.promise;
          return 'x';
        }),
    });
    const m = await reviewist.createReview({ kind: 'patch', text: 'x' });
    const p1 = reviewist.app.request(`/api/reviews/${m.id}/file?path=a.txt`);
    const p2 = reviewist.app.request(`/api/reviews/${m.id}/file?path=b.txt&side=old`);
    await tick();
    expect((await reviewist.app.request(`/api/reviews/${m.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(disposed).toEqual([]);
    gate.resolve();
    expect((await p1).status).toBe(200);
    expect((await p2).status).toBe(200);
    expect(disposed).toEqual(['cs']);
  });
});

describe('file ucu: diff dışı dosyalar ve yol güvenliği', () => {
  it('git: diff dışı dosya head ve base ağacından okunur', async () => {
    const reviewist = make();
    const m = await reviewist.createReview({ kind: 'git', repoPath: repo, base: 'main', head: 'feature' });
    const get = async (q: string): Promise<{ path: string; content: string | null }> =>
      await body(await reviewist.app.request(`/api/reviews/${m.id}/file?${q}`));
    expect(m.files.map((f) => f.path)).not.toContain('src/C.java');
    expect(await get('path=src/C.java&side=new')).toEqual({ path: 'src/C.java', side: 'new', content: 'class C { /* diff dışı */ }\n' });
    expect((await get('path=src/C.java&side=old')).content).toBe('class C { /* diff dışı */ }\n');
    expect((await get('path=src%5CC.java&side=new')).path).toBe('src/C.java'); // ters bölü normalize
    expect((await get('path=src/Yok.java&side=new')).content).toBeNull();
  });

  it('worktree: diff dışı izlenen dosya diskten, yoksayılan dosya asla', async () => {
    writeFileSync(join(repo, '.gitignore'), 'gizli.txt\n');
    writeFileSync(join(repo, 'gizli.txt'), 'SIR');
    try {
      const reviewist = make();
      const m = await reviewist.createReview({ kind: 'worktree', repoPath: repo });
      const get = async (q: string): Promise<string | null> =>
        (await body<{ content: string | null }>(await reviewist.app.request(`/api/reviews/${m.id}/file?${q}`))).content;
      expect(await get('path=src/C.java&side=new')).toBe('class C { /* diff dışı */ }\n');
      expect(await get('path=src/C.java&side=old')).toBe('class C { /* diff dışı */ }\n');
      expect(await get('path=gizli.txt&side=new')).toBeNull();
      expect(m.source.stableKey).toMatch(/^worktree:.+:HEAD$/);
    } finally {
      rmSync(join(repo, '.gitignore'), { force: true });
      rmSync(join(repo, 'gizli.txt'), { force: true });
    }
  });

  it("'..', mutlak yol ve sürücü harfi 400 + field 'path'; ChangeSet'e ulaşmaz", async () => {
    const asked: string[] = [];
    const reviewist = make({
      createChangeSet: async () =>
        fakeChangeSet('cs', [], async (_side, p) => {
          asked.push(p);
          return 'x';
        }),
    });
    const m = await reviewist.createReview({ kind: 'patch', text: 'x' });
    const bad = ['../x', 'src/../../x', '/etc/passwd', '%5C%5Cserver%5Cshare', 'C:%5CWindows%5Cwin.ini', 'C:x', 'a%00b', '.'];
    for (const p of bad) {
      const res = await reviewist.app.request(`/api/reviews/${m.id}/file?path=${p}&side=new`);
      expect(res.status, p).toBe(400);
      expect(await body<ApiError>(res), p).toMatchObject({ field: 'path' });
    }
    expect(asked).toEqual([]);
    const ok = await reviewist.app.request(`/api/reviews/${m.id}/file?path=./src//A.java&side=new`);
    expect(await body<{ path: string }>(ok)).toMatchObject({ path: 'src/A.java' });
    expect(asked).toEqual(['src/A.java']);
  });
});

describe('güvenlik: Host ve Origin', () => {
  it('yabancı Host reddedilir (DNS rebinding)', async () => {
    const { app } = make();
    const res = await app.request('http://evil.example:4317/api/config', { headers: { host: 'evil.example:4317' } });
    expect(res.status).toBe(403);
    expect((await body<ApiError>(res)).error).toContain('Host');
    for (const h of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317']) {
      expect((await app.request(`http://${h}/api/config`, { headers: { host: h } })).status).toBe(200);
    }
  });

  it('POST: yabancı Origin reddedilir, aynı origin ve vite dev (5173) kabul edilir', async () => {
    const { app } = make();
    const url = 'http://127.0.0.1:4317/api/reviews';
    const payload = { kind: 'svn' }; // doğrulamaya ulaşırsa 400 döner
    const evil = await app.request(url, post(payload, { host: '127.0.0.1:4317', origin: 'http://evil.example' }));
    expect(evil.status).toBe(403);
    expect((await body<ApiError>(evil)).error).toContain('Origin');
    const otherPort = await app.request(url, post(payload, { host: '127.0.0.1:4317', origin: 'http://localhost:3000' }));
    expect(otherPort.status).toBe(403);
    const nullOrigin = await app.request(url, post(payload, { host: '127.0.0.1:4317', origin: 'null' }));
    expect(nullOrigin.status).toBe(403);
    const same = await app.request(url, post(payload, { host: '127.0.0.1:4317', origin: 'http://localhost:4317' }));
    expect(same.status).toBe(400);
    const vite = await app.request(url, post(payload, { host: 'localhost:5173', origin: 'http://localhost:5173' }));
    expect(vite.status).toBe(400);
    const noOrigin = await app.request(url, post(payload, { host: '127.0.0.1:4317' }));
    expect(noOrigin.status).toBe(400);
  });

  it('yardımcılar', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('127.0.0.1.nip.io')).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isAllowedOrigin('https://localhost:4317', 'localhost:4317', [5173])).toBe(false);
  });
});

describe('statik arayüz', () => {
  it('dosya servis eder, SPA fallback index.html, /api/* 404 JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reviewist-web-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Reviewist</title>');
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'assets/app.js'), 'console.log(1)');
      const { app } = make({ staticDir: dir });
      const js = await app.request('/assets/app.js');
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toContain('javascript');
      expect(js.headers.get('cache-control')).toContain('immutable');
      const spa = await app.request('/reviews/abc');
      expect(spa.status).toBe(200);
      expect(spa.headers.get('cache-control')).toBe('no-cache');
      expect(await spa.text()).toContain('<title>Reviewist</title>');
      const root = await app.request('/');
      expect(root.headers.get('cache-control')).toBe('no-cache');
      expect(await root.text()).toContain('Reviewist');
      const api = await app.request('/api/yok');
      expect(api.status).toBe(404);
      expect((await body<ApiError>(api)).error).toContain('API uç noktası bulunamadı');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('staticDir yoksa yalnız API', async () => {
    const { app } = make();
    const res = await app.request('/');
    expect(res.status).toBe(404);
  });
});

describe('Tur 3: HTTP sıkıştırma ve initialReviewId', () => {
  const bigModel = (cs: ChangeSet, id: string): ReviewModel => ({
    id,
    createdAt: new Date().toISOString(),
    source: cs.info,
    summary: {
      files: 0,
      javaFiles: 0,
      testFiles: 0,
      additions: 0,
      deletions: 0,
      typesChanged: 0,
      membersChanged: 0,
      publicApiChanges: 0,
      cosmeticFiles: 0,
      highRiskItems: 0,
      impactedOutsideDiff: 0,
      untestedChanges: 0,
    },
    files: [],
    types: [],
    graph: { nodes: [], edges: [] },
    groups: [],
    reviewPlan: [],
    findings: [],
    warnings: Array.from({ length: 2000 }, (_, i) => `uyarı ${i}: Türkçe metin ğüşıöç`),
  });

  it('Accept-Encoding gzip/deflate → sıkıştırılmış JSON; başlık yoksa ham', async () => {
    const reviewist = make({
      createChangeSet: async () => fakeChangeSet('cs', []),
      buildReview: async (cs, o) => bigModel(cs, o?.id ?? 'x'),
    });
    const { app } = reviewist;
    const m = await reviewist.createReview({ kind: 'patch', text: 'x' });
    const raw = await app.request(`/api/reviews/${m.id}`);
    expect(raw.headers.get('content-encoding')).toBeNull();
    const rawText = await raw.text();
    expect(JSON.parse(rawText)).toMatchObject({ id: m.id });

    for (const enc of ['gzip', 'deflate'] as const) {
      const res = await app.request(`/api/reviews/${m.id}`, { headers: { 'accept-encoding': enc } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-encoding')).toBe(enc);
      expect(res.headers.get('vary')).toMatch(/accept-encoding/i);
      const zipped = Buffer.from(await res.arrayBuffer());
      expect(zipped.length).toBeLessThan(rawText.length / 5);
      const plain = enc === 'gzip' ? gunzipSync(zipped) : inflateSync(zipped);
      expect(plain.toString('utf8')).toBe(rawText);
    }
    // gzip öncelikli
    const both = await app.request(`/api/reviews/${m.id}`, { headers: { 'accept-encoding': 'deflate, gzip' } });
    expect(both.headers.get('content-encoding')).toBe('gzip');
    // Not: c.json Content-Length koymadığından 1 KB eşiği uygulanmaz; küçük yanıtlar da sıkıştırılır (zararsız).
    const cfg = await app.request('/api/config', { headers: { 'accept-encoding': 'gzip' } });
    expect(JSON.parse(gunzipSync(Buffer.from(await cfg.arrayBuffer())).toString('utf8'))).toMatchObject({ version: '9.9.9' });
  });

  it("initialReviewId LRU'dan düşen review için döndürülmez", async () => {
    let n = 0;
    const reviewist = make({ maxReviews: 1, createChangeSet: async () => fakeChangeSet(`cs${++n}`, []) });
    const { app } = reviewist;
    const m1 = await reviewist.createReview({ kind: 'patch', text: 'x' });
    reviewist.setInitialReviewId(m1.id);
    expect((await body<AppConfig>(await app.request('/api/config'))).initialReviewId).toBe(m1.id);
    await reviewist.createReview({ kind: 'patch', text: 'y' }); // m1 LRU'dan düşer
    expect((await app.request(`/api/reviews/${m1.id}`)).status).toBe(404);
    expect((await body<AppConfig>(await app.request('/api/config'))).initialReviewId).toBeUndefined();
  });

  it('config isteği LRU sırasını değiştirmez', async () => {
    let n = 0;
    const reviewist = make({ maxReviews: 2, createChangeSet: async () => fakeChangeSet(`cs${++n}`, []) });
    const { app } = reviewist;
    const m1 = await reviewist.createReview({ kind: 'patch', text: 'x' });
    reviewist.setInitialReviewId(m1.id);
    await reviewist.createReview({ kind: 'patch', text: 'y' });
    await app.request('/api/config'); // m1'i "kullanılmış" yapmamalı
    await reviewist.createReview({ kind: 'patch', text: 'z' }); // en eski (m1) düşer
    expect((await body<AppConfig>(await app.request('/api/config'))).initialReviewId).toBeUndefined();
  });
});

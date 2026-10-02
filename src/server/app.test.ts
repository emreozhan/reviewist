import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError, AppConfig, ChangeSet, GitRefs, ReviewListItem, ReviewModel } from '../shared/types.js';
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
    expect(model.summary.javaFiles).toBe(2);
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
  });

  it('kaynak uyarıları modele eklenir; LRU taşmasında ChangeSet dispose edilir', async () => {
    const disposed: string[] = [];
    const fakeCs = (name: string): ManagedChangeSet => ({
      info: { kind: 'patch', title: name, baseRef: 'a', headRef: 'b' },
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
        info: { kind: 'patch', title: 't', baseRef: 'a', headRef: 'b' },
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
      const spa = await app.request('/reviews/abc');
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain('<title>Reviewist</title>');
      const root = await app.request('/');
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

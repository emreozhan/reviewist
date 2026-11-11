/**
 * Tur 4: GET /api/reviews/:id/outline ve /locate uçları (gerçek analiz motoru, geçici git deposu).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, FileOutline, ReviewModel, SymbolLocation } from '../shared/types.js';
import { buildArtifacts } from '../core/buildReview.js';
import { createApp, type BuildArtifactsFn, type ReviewistApp } from './app.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const P = 'src/main/java/p';
let repo: string;
const apps: ReviewistApp[] = [];

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'reviewist-nav-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  write(repo, `${P}/Api.java`, 'package p;\n\npublic interface Api {\n    void charge(int amount);\n}\n');
  write(repo, `${P}/Util.java`, 'package p;\n\npublic class Util {\n    public static int twice(int x) { return 2 * x; }\n}\n');
  write(repo, `${P}/Service.java`, 'package p;\n\npublic class Service {\n    private final Api api = null;\n\n    void run() {\n        api.charge(1);\n    }\n\n    void legacy() { }\n}\n');
  write(repo, 'README.md', '# r\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'c1');
  git(repo, 'checkout', '-q', '-b', 'feature');
  write(repo, `${P}/Service.java`, 'package p;\n\npublic class Service {\n    private final Api api = null;\n\n    void run() {\n        api.charge(Util.twice(1));\n    }\n}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'c2');
});

afterEach(async () => {
  while (apps.length) await apps.pop()?.dispose();
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

function make(opts: Parameters<typeof createApp>[0] = {}): ReviewistApp {
  const a = createApp({ defaultRepoPath: repo, ...opts });
  apps.push(a);
  return a;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

async function newReview(a: ReviewistApp): Promise<ReviewModel> {
  return await a.createReview({ kind: 'git', repoPath: repo, base: 'main', head: 'feature' });
}

describe('GET /api/reviews/:id/outline', () => {
  it('değişen ve diff dışı dosya, old taraf, Java dışı dosya; hatalar Türkçe', async () => {
    const a = make();
    const { app } = a;
    const model = await newReview(a);
    const res = await app.request(`/api/reviews/${model.id}/outline?path=${enc(`${P}/Service.java`)}&side=new`);
    expect(res.status).toBe(200);
    const o = await json<FileOutline>(res);
    expect(o).toMatchObject({ path: `${P}/Service.java`, side: 'new', inDiff: true, packageName: 'p' });
    expect(o.refs.find((r) => r.name === 'charge')).toMatchObject({ kind: 'call', line: 7, startCol: 12, endCol: 18, targets: ['p.Api#charge(int)'] });
    expect(o.refs.find((r) => r.name === 'twice')?.targets).toEqual(['p.Util#twice(int)']);
    expect(o.refs.find((r) => r.name === 'Util')).toMatchObject({ kind: 'type', targets: ['p.Util'] });
    expect(o.decls.find((d) => d.id === 'p.Service#run()')?.status).toBe('modified');

    const out = await json<FileOutline>(await app.request(`/api/reviews/${model.id}/outline?path=${enc(`${P}/Util.java`)}`));
    expect(out).toMatchObject({ side: 'new', inDiff: false });
    expect(out.decls.map((d) => d.id)).toEqual(['p.Util', 'p.Util#twice(int)']);

    const old = await json<FileOutline>(await app.request(`/api/reviews/${model.id}/outline?path=${enc(`${P}/Service.java`)}&side=old`));
    expect(old.decls.find((d) => d.id === 'p.Service#legacy()')?.status).toBe('removed');

    expect(await json<FileOutline>(await app.request(`/api/reviews/${model.id}/outline?path=README.md`))).toEqual({
      path: 'README.md',
      side: 'new',
      inDiff: false,
      decls: [],
      refs: [],
    });

    const missing = await app.request(`/api/reviews/${model.id}/outline?path=${enc(`${P}/Yok.java`)}&side=new`);
    expect(missing.status).toBe(404);
    expect(await json<ApiError>(missing)).toMatchObject({ error: `Dosya bulunamadı: ${P}/Yok.java (yeni taraf).`, field: 'path' });
    const badSide = await app.request(`/api/reviews/${model.id}/outline?path=README.md&side=x`);
    expect(badSide.status).toBe(400);
    expect((await json<ApiError>(badSide)).field).toBe('side');
    const noPath = await app.request(`/api/reviews/${model.id}/outline`);
    expect(noPath.status).toBe(400);
    for (const bad of ['../etc/passwd', '/etc/passwd', 'C:/x.java']) {
      const r = await app.request(`/api/reviews/${model.id}/outline?path=${enc(bad)}`);
      expect(r.status).toBe(400);
      expect((await json<ApiError>(r)).field).toBe('path');
    }
    const noReview = await app.request(`/api/reviews/yok/outline?path=README.md`);
    expect(noReview.status).toBe(404);
    expect((await json<ApiError>(noReview)).error).toContain('Review bulunamadı');
  });
});

describe('GET /api/reviews/:id/locate', () => {
  it('değişen, silinen, diff dışı sembol; bulunamayan 404; id yoksa 400', async () => {
    const a = make();
    const { app } = a;
    const model = await newReview(a);
    const loc = (id: string) => app.request(`/api/reviews/${model.id}/locate?id=${enc(id)}`);
    expect(await json<SymbolLocation>(await loc('p.Service#run()'))).toMatchObject({
      id: 'p.Service#run()',
      kind: 'method',
      path: `${P}/Service.java`,
      side: 'new',
      inDiff: true,
      typeId: 'p.Service',
      range: { startLine: 6, endLine: 8 },
    });
    expect(await json<SymbolLocation>(await loc('p.Service#legacy()'))).toMatchObject({ side: 'old', range: { startLine: 10, endLine: 10 } });
    expect(await json<SymbolLocation>(await loc('p.Util#twice(int)'))).toMatchObject({ side: 'new', inDiff: false, path: `${P}/Util.java` });
    expect(await json<SymbolLocation>(await loc('p.Api'))).toMatchObject({ kind: 'interface', inDiff: false });
    const nf = await loc('p.Yok#x()');
    expect(nf.status).toBe(404);
    expect(await json<ApiError>(nf)).toMatchObject({ error: 'Sembol bulunamadı: p.Yok#x()', field: 'id' });
    const noId = await app.request(`/api/reviews/${model.id}/locate`);
    expect(noId.status).toBe(400);
    expect((await app.request('/api/reviews/yok/locate?id=p.Api')).status).toBe(404);
  });
});

describe('gezinme önbelleği (LRU) ve yeniden kurulum', () => {
  it('LRU dışına düşen review için artefaktlar bir kez yeniden kurulur; eşzamanlı istekler aynı kurulumu bekler', async () => {
    let calls = 0;
    const counting: BuildArtifactsFn = async (cs, opts) => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return await buildArtifacts(cs, opts);
    };
    const a = make({ maxNavigationCaches: 1, buildArtifacts: counting });
    const { app } = a;
    const first = await newReview(a);
    const url = (id: string) => `/api/reviews/${id}/outline?path=${enc(`${P}/Service.java`)}`;
    const warm = await json<FileOutline>(await app.request(url(first.id)));
    expect(calls).toBe(0); // analizden gelen artefaktlar
    const second = await newReview(a); // first gezinme önbelleğinden düşer
    await app.request(url(second.id));
    expect(calls).toBe(0);
    const results = await Promise.all([
      app.request(url(first.id)),
      app.request(url(first.id)),
      app.request(`/api/reviews/${first.id}/locate?id=${enc('p.Util#twice(int)')}`),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(calls).toBe(1);
    expect(await json<FileOutline>(results[0] as Response)).toEqual(warm);
    // tekrar sıcak
    await app.request(url(first.id));
    expect(calls).toBe(1);
  });

  it('yeniden kurulum hatası 500 Türkçe; sonraki istek yeniden dener', async () => {
    let fail = true;
    const flaky: BuildArtifactsFn = async (cs, opts) => {
      if (fail) throw new Error('disk dolu');
      return await buildArtifacts(cs, opts);
    };
    const a = make({ maxNavigationCaches: 1, buildArtifacts: flaky });
    const { app } = a;
    const first = await newReview(a);
    await newReview(a);
    const res = await app.request(`/api/reviews/${first.id}/locate?id=p.Api`);
    expect(res.status).toBe(500);
    expect(await json<ApiError>(res)).toMatchObject({ error: 'Kod gezinme verisi hazırlanamadı (repo indeksi yeniden kurulamadı).', detail: 'disk dolu' });
    fail = false;
    expect((await app.request(`/api/reviews/${first.id}/locate?id=p.Api`)).status).toBe(200);
  });

  it('DELETE sonrası outline 404', async () => {
    const a = make();
    const { app } = a;
    const m = await newReview(a);
    expect((await app.request(`/api/reviews/${m.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/reviews/${m.id}/outline?path=README.md`)).status).toBe(404);
  });
});

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { c as tarCreate } from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedChangeSet } from './common.js';
import { SourceError } from './errors.js';
import { createGithubChangeSet, parsePrUrl, parseRemoteUrl, resolveGithubToken, resolveGithubTokenFor } from './github.js';

const TOKEN = 'test-token-should-never-leak-123';
const API = 'https://api.github.com';
const BASE_SHA = 'b'.repeat(40);
const HEAD_SHA = 'h'.repeat(40).replace(/h/g, 'c');
const MB_SHA = 'a'.repeat(40);

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;
interface Call {
  url: string;
  headers: Record<string, string>;
}

let calls: Call[] = [];
const cleanups: (() => unknown)[] = [];

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function installFetch(routes: [RegExp, Handler][]): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url: url.href, headers });
    const target = url.pathname + url.search;
    for (const [re, h] of routes) if (re.test(target)) return await h(url, init);
    return json({ message: 'Not Found' }, 404);
  });
}

function pullMeta(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'Sipariş servisi yeniden düzenlendi',
    body: 'Açıklama **markdown**',
    html_url: 'https://github.com/acme/shop/pull/7',
    changed_files: 150,
    user: { login: 'ayse' },
    base: { ref: 'main', sha: BASE_SHA, repo: { full_name: 'acme/shop' } },
    head: { ref: 'feature/x', sha: HEAD_SHA, repo: { full_name: 'acme/shop' } },
    ...over,
  };
}

function prFiles(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    filename: `src/F${i}.java`,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: `@@ -1,2 +1,2 @@\n class F${i} {\n-int a;\n+int b;`,
  }));
}

const commonRoutes = (files: Record<string, unknown>[]): [RegExp, Handler][] => [
  [/^\/repos\/acme\/shop\/pulls\/7$/, () => json(pullMeta({ changed_files: files.length }))],
  [/^\/repos\/acme\/shop\/compare\//, () => json({ merge_base_commit: { sha: MB_SHA } })],
  [
    /^\/repos\/acme\/shop\/pulls\/7\/files\?/,
    (url) => {
      const page = Number(url.searchParams.get('page'));
      const per = Number(url.searchParams.get('per_page'));
      return json(files.slice((page - 1) * per, page * per));
    },
  ],
];

beforeEach(() => {
  calls = [];
  vi.stubEnv('GITHUB_TOKEN', '');
  vi.stubEnv('GH_TOKEN', '');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  while (cleanups.length) await cleanups.pop()?.();
});

function track(cs: ManagedChangeSet): ManagedChangeSet {
  cleanups.push(() => cs.dispose());
  return cs;
}

function assertNoTokenLeak(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(TOKEN);
}

describe('parsePrUrl / parseRemoteUrl / token', () => {
  it('github.com, ek yol, GHE ve kısa biçim', () => {
    expect(parsePrUrl('https://github.com/acme/shop/pull/7/files?diff=split')).toMatchObject({
      host: 'github.com',
      owner: 'acme',
      repo: 'shop',
      number: 7,
      apiBase: 'https://api.github.com',
    });
    expect(parsePrUrl('https://git.sirket.com.tr/takim/servis/pull/12/commits')).toMatchObject({
      host: 'git.sirket.com.tr',
      apiBase: 'https://git.sirket.com.tr/api/v3',
      number: 12,
    });
    expect(parsePrUrl('acme/shop#3')).toMatchObject({ owner: 'acme', repo: 'shop', number: 3 });
    expect(() => parsePrUrl('https://github.com/acme/shop/issues/7')).toThrow(SourceError);
    expect(() => parsePrUrl('ftp://github.com/a/b/pull/1')).toThrow(/Geçersiz PR adresi/);
  });

  it('remote adresleri', () => {
    expect(parseRemoteUrl('git@github.com:Acme/Shop.git')).toEqual({ host: 'github.com', owner: 'Acme', repo: 'Shop' });
    expect(parseRemoteUrl('https://github.com/acme/shop')).toEqual({ host: 'github.com', owner: 'acme', repo: 'shop' });
    expect(parseRemoteUrl('ssh://git@git.sirket.com:2222/takim/servis.git')).toEqual({
      host: 'git.sirket.com',
      owner: 'takim',
      repo: 'servis',
    });
    expect(parseRemoteUrl('C:/yerel/depo')).toBeUndefined();
  });

  it('token sırası: istek → GITHUB_TOKEN → GH_TOKEN', () => {
    vi.stubEnv('GH_TOKEN', 'gh');
    expect(resolveGithubToken()).toBe('gh');
    vi.stubEnv('GITHUB_TOKEN', 'github');
    expect(resolveGithubToken()).toBe('github');
    expect(resolveGithubToken('istek')).toBe('istek');
    vi.stubEnv('OZEL', 'ozel');
    expect(resolveGithubToken(undefined, ['OZEL', 'GITHUB_TOKEN'])).toBe('ozel');
  });

  it('ortam token\'ı yalnız github.com ve REVIEWIST_GITHUB_HOSTS sunucularına gider; formdaki token her sunucuya', () => {
    vi.stubEnv('GITHUB_TOKEN', 'gizli');
    vi.stubEnv('REVIEWIST_GITHUB_HOSTS', '');
    expect(resolveGithubTokenFor('github.com')).toEqual({ token: 'gizli' });
    expect(resolveGithubTokenFor('GitHub.com')).toEqual({ token: 'gizli' });
    // Yapıştırılan yabancı adres: token gönderilmez, nedeni raporlanır
    expect(resolveGithubTokenFor('github.com.evil.example')).toEqual({ withheldEnv: 'GITHUB_TOKEN' });
    expect(resolveGithubTokenFor('git.sirket.com.tr')).toEqual({ withheldEnv: 'GITHUB_TOKEN' });
    // Formda girilen token kullanıcının bilinçli seçimidir
    expect(resolveGithubTokenFor('git.sirket.com.tr', 'elle')).toEqual({ token: 'elle' });
    // Kurumsal sunucu açıkça güvenilir listesine alınabilir
    vi.stubEnv('REVIEWIST_GITHUB_HOSTS', 'git.sirket.com.tr, ghe.example');
    expect(resolveGithubTokenFor('git.sirket.com.tr')).toEqual({ token: 'gizli' });
    expect(resolveGithubTokenFor('ghe.example')).toEqual({ token: 'gizli' });
    expect(resolveGithubTokenFor('other.example')).toEqual({ withheldEnv: 'GITHUB_TOKEN' });
    vi.stubEnv('GITHUB_TOKEN', '');
    expect(resolveGithubTokenFor('github.com')).toEqual({});
  });

  it('http ve kimlik bilgisi gömülü PR adresleri reddedilir', () => {
    expect(() => parsePrUrl('http://github.com/acme/shop/pull/7')).toThrow(/https/);
    expect(() => parsePrUrl('https://github.com:x@evil.example/acme/shop/pull/7')).toThrow(/Geçersiz PR adresi/);
    expect(() => parsePrUrl('https://user@github.com/acme/shop/pull/7')).toThrow(/Geçersiz PR adresi/);
  });
});

describe('createGithubChangeSet (API yolu)', () => {
  it('sayfalama, rename/removed eşlemesi, PR meta, başlıklar', async () => {
    const files = prFiles(148);
    files.push(
      { filename: 'src/Yeni.java', previous_filename: 'src/Eski.java', status: 'renamed', additions: 0, deletions: 0, changes: 0 },
      { filename: 'src/Gone.java', status: 'removed', additions: 0, deletions: 3, changes: 3, patch: '@@ -1,3 +0,0 @@\n-a\n-b\n-c' },
      { filename: 'img/logo.png', status: 'added', additions: 0, deletions: 0, changes: 0 },
    );
    installFetch(commonRoutes(files));
    const cs = track(await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7', token: TOKEN }));

    expect(cs.files).toHaveLength(151);
    const pages = calls.filter((c) => c.url.includes('/files?'));
    expect(pages.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(cs.info).toMatchObject({
      kind: 'github',
      title: 'Sipariş servisi yeniden düzenlendi',
      author: 'ayse',
      description: 'Açıklama **markdown**',
      prNumber: 7,
      prUrl: 'https://github.com/acme/shop/pull/7',
      baseRef: 'main',
      headRef: 'feature/x',
      baseSha: MB_SHA, // diff merge-base'e göre
      headSha: HEAD_SHA,
    });
    const byPath = new Map(cs.files.map((f) => [f.path, f]));
    expect(byPath.get('src/Yeni.java')).toMatchObject({ status: 'renamed', oldPath: 'src/Eski.java', binary: false });
    expect(byPath.get('src/Gone.java')).toMatchObject({ status: 'deleted', deletions: 3 });
    expect(byPath.get('src/Gone.java')?.hunks[0]?.lines).toHaveLength(3);
    expect(byPath.get('img/logo.png')).toMatchObject({ binary: true });
    expect(byPath.get('src/F0.java')?.hunks[0]?.lines[2]).toEqual({ type: 'add', newNo: 2, text: 'int b;' });

    const h = calls[0]?.headers ?? {};
    expect(h.accept).toBe('application/vnd.github+json');
    expect(h['x-github-api-version']).toBe('2022-11-28');
    expect(h['user-agent']).toMatch(/reviewist/);
    expect(h.authorization).toBe(`Bearer ${TOKEN}`);
    assertNoTokenLeak({ info: cs.info, files: cs.files, warnings: cs.warnings });
  });

  it('readFile: raw içerik, eski taraf merge-base, 404 → undefined, eşzamanlılık ≤ 8, önbellek', async () => {
    let active = 0;
    let maxActive = 0;
    installFetch([
      ...commonRoutes([
        ...prFiles(20),
        { filename: 'src/Yeni.java', previous_filename: 'src/Eski.java', status: 'renamed', additions: 1, deletions: 0, changes: 1, patch: '@@ -1 +1,2 @@\n x\n+y' },
      ]),
      [
        /^\/repos\/acme\/shop\/contents\//,
        async (url, init) => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
          const accept = new Headers(init?.headers).get('accept');
          if (accept !== 'application/vnd.github.raw') return json({ message: 'yanlış accept' }, 400);
          const path = decodeURIComponent(url.pathname.replace('/repos/acme/shop/contents/', ''));
          const ref = url.searchParams.get('ref');
          if (path === 'src/Yok.java') return json({ message: 'Not Found' }, 404);
          return new Response(`// ${path} @ ${ref}\n`, { status: 200 });
        },
      ],
    ]);
    const cs = track(await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7' }));
    const reads = await Promise.all(Array.from({ length: 20 }, (_, i) => cs.readFile('new', `src/F${i}.java`)));
    expect(reads[3]).toBe(`// src/F3.java @ ${HEAD_SHA}\n`);
    expect(maxActive).toBeLessThanOrEqual(8);
    expect(maxActive).toBeGreaterThan(1);
    expect(await cs.readFile('old', 'src/F1.java')).toBe(`// src/F1.java @ ${MB_SHA}\n`);
    expect(await cs.readFile('old', 'src/Yeni.java')).toBe(`// src/Eski.java @ ${MB_SHA}\n`);
    expect(await cs.readFile('new', 'src/Yok.java')).toBeUndefined();
    const before = calls.length;
    await cs.readFile('new', 'src/F3.java');
    expect(calls.length).toBe(before); // önbellekten
    // token yoksa Authorization başlığı yok
    expect(calls.every((c) => c.headers.authorization === undefined)).toBe(true);
  });

  it('403 rate limit: Türkçe mesaj, sıfırlanma zamanı, token sızmaz', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    installFetch([
      [
        /^\/repos\/acme\/shop\/pulls\/7$/,
        () =>
          json({ message: 'API rate limit exceeded for user.' }, 403, {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(reset),
          }),
      ],
    ]);
    const err = await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7', token: TOKEN }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    const se = err as SourceError;
    expect(se.code).toBe('GITHUB_RATE_LIMIT');
    expect(se.status).toBe(429);
    expect(se.message).toContain('istek sınırı aşıldı');
    expect(se.message).toMatch(/saat \d{2}:\d{2}/);
    expect(se.detail).toContain(new Date(reset * 1000).toISOString());
    assertNoTokenLeak({ m: se.message, d: se.detail });

    // token yoksa yönlendirme metni
    installFetch([[/pulls\/7$/, () => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) })]]);
    const e2 = (await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7' }).catch((e: unknown) => e)) as SourceError;
    expect(e2.message).toContain('GITHUB_TOKEN');
  });

  it('401 ve 404 yönlendirici mesajlar', async () => {
    installFetch([[/pulls\/7$/, () => json({ message: 'Bad credentials' }, 401)]]);
    const e401 = (await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7', token: TOKEN }).catch((e: unknown) => e)) as SourceError;
    expect(e401).toMatchObject({ status: 401, code: 'GITHUB_AUTH' });
    expect(e401.message).toContain('token geçersiz');
    assertNoTokenLeak({ m: e401.message, d: e401.detail });

    installFetch([]);
    const e404 = (await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7' }).catch((e: unknown) => e)) as SourceError;
    expect(e404).toMatchObject({ status: 404, code: 'GITHUB_NOT_FOUND' });
    expect(e404.message).toContain('PR bulunamadı: acme/shop#7');
    expect(e404.message).toContain('GITHUB_TOKEN');
  });

  it('tarball başarısızsa yalnız değişen dosyalar + uyarı', async () => {
    installFetch([
      ...commonRoutes([
        ...prFiles(2),
        { filename: 'src/Gone.java', status: 'removed', additions: 0, deletions: 1, changes: 1, patch: '@@ -1 +0,0 @@\n-a' },
        { filename: 'README.md', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ -1 +1,2 @@\n x\n+y' },
      ]),
      [/\/tarball\//, () => json({ message: 'Not Found' }, 404)],
    ]);
    const cs = track(await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7' }));
    expect(await cs.listFiles('new', '.java')).toEqual(['src/F0.java', 'src/F1.java']);
    expect(cs.warnings.some((w) => w.includes('tarball') && w.includes('yalnızca'))).toBe(true);
    // ikinci çağrı yeniden indirmeyi denemez
    const n = calls.filter((c) => c.url.includes('/tarball/')).length;
    await cs.listFiles('new');
    expect(calls.filter((c) => c.url.includes('/tarball/')).length).toBe(n);
  });

  it('tarball başarılıysa .java dosyaları geçici dizine çıkar, readFile oradan okur, dispose siler', async () => {
    const work = mkdtempSync(join(tmpdir(), 'reviewist-tartest-'));
    cleanups.push(() => rmSync(work, { recursive: true, force: true }));
    const prefix = 'acme-shop-ccccccc';
    const put = (rel: string, content: string): void => {
      const abs = join(work, prefix, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    };
    put('src/F0.java', 'class F0 { /* tarball */ }\n');
    put('src/util/Yardımcı.java', 'class Yardimci {}\n');
    put('README.md', '# readme\n');
    const tgz = join(work, 'repo.tgz');
    await tarCreate({ gzip: true, cwd: work, file: tgz, portable: true }, [prefix]);
    const tgzBytes = readFileSync(tgz);

    installFetch([
      ...commonRoutes(prFiles(1)),
      [/\/tarball\//, () => new Response(tgzBytes, { status: 200, headers: { 'content-type': 'application/x-gzip' } })],
    ]);
    const countGh = (): number => readdirSync(tmpdir()).filter((d) => d.startsWith('reviewist-gh-')).length;
    const before = countGh();
    const cs = await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7' });
    expect((await cs.listFiles('new', '.java')).sort()).toEqual(['src/F0.java', 'src/util/Yardımcı.java']);
    expect(await cs.listFiles('new')).toContain('README.md');
    expect(countGh()).toBe(before + 1);
    const contentCalls = calls.filter((c) => c.url.includes('/contents/')).length;
    expect(await cs.readFile('new', 'src/F0.java')).toBe('class F0 { /* tarball */ }\n');
    expect(calls.filter((c) => c.url.includes('/contents/')).length).toBe(contentCalls); // API çağrısı yok
    expect(cs.warnings).toEqual([]);
    await cs.dispose();
    expect(countGh()).toBe(before);
  });

  it('GitHub patch vermeyen büyük dosyanın hunk\'ları içerikten üretilir', async () => {
    installFetch([
      ...commonRoutes([{ filename: 'src/Big.java', status: 'modified', additions: 1, deletions: 1, changes: 2 }]),
      [
        /\/contents\//,
        (url) =>
          new Response(url.searchParams.get('ref') === MB_SHA ? 'a\nb\nc\n' : 'a\nB\nc\n', { status: 200 }),
      ],
    ]);
    const cs = track(await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7' }));
    expect(cs.files[0]?.hunks[0]?.lines).toEqual([
      { type: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { type: 'del', oldNo: 2, text: 'b' },
      { type: 'add', newNo: 2, text: 'B' },
      { type: 'context', oldNo: 3, newNo: 3, text: 'c' },
    ]);
  });

  it('stableKey, sayfa ilerlemesi, diff dışı dosya contents API ile, yol geçişi reddi', async () => {
    installFetch([
      ...commonRoutes(prFiles(150)),
      [
        /^\/repos\/acme\/shop\/contents\//,
        (url) => new Response(`// ${decodeURIComponent(url.pathname)} @ ${url.searchParams.get('ref')}\n`, { status: 200 }),
      ],
    ]);
    const progress: string[] = [];
    const cs = track(
      await createGithubChangeSet({ url: 'https://www.github.com/acme/shop/pull/7/files', onProgress: (m) => progress.push(m) }),
    );
    expect(cs.info.stableKey).toBe('github:github.com/acme/shop#7');
    expect(progress).toContain('GitHub dosya listesi: sayfa 1');
    expect(progress).toContain('GitHub dosya listesi: sayfa 2');

    // Diff dışı dosya (PR'da yok): head ve merge-base ağacından contents API ile
    expect(await cs.readFile('new', 'src/main/Diger.java')).toBe(`// /repos/acme/shop/contents/src/main/Diger.java @ ${HEAD_SHA}\n`);
    expect(await cs.readFile('old', 'docs/notlar.md')).toBe(`// /repos/acme/shop/contents/docs/notlar.md @ ${MB_SHA}\n`);

    // '..' ve mutlak yol: GitHub'a istek bile gitmez
    const before = calls.length;
    expect(await cs.readFile('new', '../../../user')).toBeUndefined();
    expect(await cs.readFile('new', 'src/../../pulls')).toBeUndefined();
    expect(await cs.readFile('new', '/etc/passwd')).toBeUndefined();
    expect(calls.length).toBe(before);
  });

  it('hata alanları: geçersiz URL → url, 401 → token, 404 → url', async () => {
    await expect(createGithubChangeSet({ url: 'https://github.com/a/b/issues/1' })).rejects.toMatchObject({ field: 'url' });
    installFetch([[/^\/repos\/acme\/shop\/pulls\/7$/, () => json({ message: 'Bad credentials' }, 401)]]);
    await expect(createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7', token: TOKEN })).rejects.toMatchObject({
      code: 'GITHUB_AUTH',
      field: 'token',
    });
    installFetch([]);
    await expect(createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7' })).rejects.toMatchObject({
      code: 'GITHUB_NOT_FOUND',
      field: 'url',
    });
  });

  it('tarball indirme ilerlemesi MB olarak bildirilir', async () => {
    const work = mkdtempSync(join(tmpdir(), 'reviewist-tartest-'));
    cleanups.push(() => rmSync(work, { recursive: true, force: true }));
    const prefix = 'acme-shop-ccccccc';
    mkdirSync(join(work, prefix, 'src'), { recursive: true });
    writeFileSync(join(work, prefix, 'src/F0.java'), 'class F0 {}\n');
    // Sıkıştırılamayan ~6 MB'lık dosya: indirme sırasında en az bir MB mesajı üretir
    writeFileSync(join(work, prefix, 'blob.bin'), randomBytes(6 * 1024 * 1024));
    const tgz = join(work, 'repo.tgz');
    await tarCreate({ gzip: true, cwd: work, file: tgz, portable: true }, [prefix]);
    const tgzBytes = readFileSync(tgz);
    installFetch([
      ...commonRoutes(prFiles(1)),
      [
        /\/tarball\//,
        () =>
          new Response(tgzBytes, {
            status: 200,
            headers: { 'content-type': 'application/x-gzip', 'content-length': String(tgzBytes.length) },
          }),
      ],
    ]);
    const progress: string[] = [];
    const cs = track(
      await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7', onProgress: (m) => progress.push(m) }),
    );
    await cs.listFiles('new', '.java');
    expect(progress.some((m) => /^Tarball indiriliyor \(toplam \d+\.\d MB\)$/.test(m))).toBe(true);
    expect(progress.some((m) => /^Tarball indiriliyor \([5-7] MB\)$/.test(m))).toBe(true);
    expect(progress.some((m) => m.startsWith('Depo arşivi açıldı: 2 dosya'))).toBe(true);
  });
});

describe('createGithubChangeSet (yerel depo yolu)', () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  it('remote eşleşirse git fetch + merge-base diff kullanılır (ağsız: insteadOf ile yerel bare depo)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reviewist-ghlocal-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
    const bare = join(root, 'bare.git');
    const author = join(root, 'author');
    const local = join(root, 'local');
    git(root, 'init', '-q', '--bare', bare);
    mkdirSync(author);
    git(author, 'init', '-q', '-b', 'main');
    git(author, 'config', 'user.name', 'T');
    git(author, 'config', 'user.email', 't@example.com');
    writeFileSync(join(author, 'A.java'), 'class A {}\n');
    git(author, 'add', '-A');
    git(author, 'commit', '-q', '-m', 'c1');
    const c1 = git(author, 'rev-parse', 'HEAD').trim();
    git(author, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(author, 'A.java'), 'class A { int x; }\n');
    git(author, 'commit', '-q', '-am', 'c2');
    const c2 = git(author, 'rev-parse', 'HEAD').trim();
    git(author, 'push', '-q', bare, 'main', 'feature:refs/pull/7/head');

    mkdirSync(local);
    git(local, 'init', '-q', '-b', 'main');
    git(local, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git');
    git(local, 'config', `url.${bare.replace(/\\/g, '/')}.insteadOf`, 'https://github.com/acme/shop.git');

    installFetch([
      [
        /^\/repos\/acme\/shop\/pulls\/7$/,
        () => json(pullMeta({ base: { ref: 'main', sha: c1, repo: null }, head: { ref: 'feature', sha: c2, repo: null } })),
      ],
    ]);
    const cs = track(await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7', localRepoPath: local }));
    expect(cs.info).toMatchObject({ kind: 'github', title: 'Sipariş servisi yeniden düzenlendi', prNumber: 7, baseSha: c1, headSha: c2 });
    expect(cs.files.map((f) => [f.path, f.status])).toEqual([['A.java', 'modified']]);
    expect(await cs.readFile('new', 'A.java')).toBe('class A { int x; }\n');
    expect(await cs.readFile('old', 'A.java')).toBe('class A {}\n');
    expect(calls).toHaveLength(1); // yalnız PR meta; içerikler yerel git'ten
    expect(git(local, 'rev-parse', 'refs/reviewist/pr-7').trim()).toBe(c2);
  });

  it('remote eşleşmezse uyarı verip API yoluna düşer', async () => {
    const local = mkdtempSync(join(tmpdir(), 'reviewist-ghother-'));
    cleanups.push(() => rmSync(local, { recursive: true, force: true }));
    git(local, 'init', '-q', '-b', 'main');
    git(local, 'remote', 'add', 'origin', 'git@github.com:baska/depo.git');
    installFetch(commonRoutes(prFiles(1)));
    const cs = track(await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7', localRepoPath: local }));
    expect(cs.files).toHaveLength(1);
    expect(cs.warnings[0]).toContain('ait değil');
  });
});

describe('createGithubChangeSet blobId (Tur 3)', () => {
  it("API dosya listesindeki sha yeni taraf blob'udur; eski taraf ve diff dışı dosyalar undefined", async () => {
    const shaA = '1'.repeat(40);
    const shaR = '2'.repeat(40);
    installFetch(
      commonRoutes([
        { filename: 'src/A.java', status: 'modified', additions: 1, deletions: 1, changes: 2, sha: shaA, patch: '@@ -1 +1 @@\n-a\n+b' },
        { filename: 'src/Yeni.java', previous_filename: 'src/Eski.java', status: 'renamed', additions: 0, deletions: 0, changes: 0, sha: shaR },
        { filename: 'src/Gone.java', status: 'removed', additions: 0, deletions: 1, changes: 1, sha: '3'.repeat(40), patch: '@@ -1 +0,0 @@\n-a' },
        { filename: 'img/x.png', status: 'added', additions: 0, deletions: 0, changes: 0, sha: '4'.repeat(40) },
        { filename: 'src/NoSha.java', status: 'added', additions: 1, deletions: 0, changes: 1, sha: null, patch: '@@ -0,0 +1 @@\n+a' },
      ]),
    );
    const cs = track(await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7' }));
    expect(await cs.blobId?.('new', 'src/A.java')).toBe(shaA);
    expect(await cs.blobId?.('new', 'src/Yeni.java')).toBe(shaR);
    expect(await cs.blobId?.('old', 'src/A.java')).toBeUndefined();
    expect(await cs.blobId?.('new', 'src/Gone.java')).toBeUndefined();
    expect(await cs.blobId?.('new', 'src/Eski.java')).toBeUndefined();
    expect(await cs.blobId?.('new', 'img/x.png')).toBeUndefined(); // ikili
    expect(await cs.blobId?.('new', 'src/NoSha.java')).toBeUndefined();
    expect(await cs.blobId?.('new', 'src/Diger.java')).toBeUndefined(); // tarball/diff dışı
  });
});

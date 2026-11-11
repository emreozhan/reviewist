/**
 * Uçtan uca (ağsız): geçici klasörde "uzak" bir bare depo kurulur; REVIEWIST_ALLOW_FILE_REMOTE=1 ile yerel yol
 * uzak adres olarak kullanılır. github.com adresli PR testinde `url.<bare>.insteadOf` ile git yerel depoya yönlenir,
 * PR bilgisi isteği `fetch` saplamasıyla yanıtlanır.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedChangeSet } from '../../shared/src/sources/common.js';
import { SourceError } from '../../shared/src/sources/errors.js';
import { repoDirFor } from './cache.js';
import { parseRemoteSpec } from './remote.js';
import { assertRefName, createGithubChangeSet, encodeRefPart, mapRemoteGitError, parseLsRemote } from './source.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

let root = '';
let bare = '';
let work = '';
let featureSha = '';
let mainSha = '';
const cleanups: (() => unknown)[] = [];

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'reviewist-ghsrc-')));
  bare = join(root, 'remotes', 'acme', 'shop.git');
  work = join(root, 'work');
  mkdirSync(dirname(bare), { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.name', 'T');
  git(work, 'config', 'user.email', 't@example.com');
  write(work, 'src/A.java', 'class A {}\n');
  write(work, 'src/B.java', 'class B {}\n');
  write(work, 'README.md', '# shop\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'c1');
  git(work, 'checkout', '-q', '-b', 'feature');
  write(work, 'src/A.java', 'class A { int x; }\n');
  write(work, 'src/C.java', 'class C {}\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'f1');
  featureSha = git(work, 'rev-parse', 'HEAD').trim();
  git(work, 'tag', 'v1');
  git(work, 'checkout', '-q', 'main');
  // Dal ayrıldıktan sonra main'de değişiklik: merge-base semantiğinde diff'e girmemeli.
  write(work, 'src/B.java', 'class B { int y; }\n');
  git(work, 'commit', '-q', '-am', 'c2');
  mainSha = git(work, 'rev-parse', 'HEAD').trim();
  git(work, 'push', '-q', bare, 'main', 'feature', 'v1');
  git(bare, 'update-ref', 'refs/pull/7/head', featureSha);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

beforeEach(() => {
  vi.stubEnv('REVIEWIST_ALLOW_FILE_REMOTE', '1');
  vi.stubEnv('GITHUB_TOKEN', '');
  vi.stubEnv('GH_TOKEN', '');
  vi.stubEnv('REVIEWIST_GIT_PROTOCOL', '');
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

function newCacheDir(): string {
  const dir = join(root, 'caches', `c${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function failure(p: Promise<unknown>): Promise<SourceError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SourceError);
  return err as SourceError;
}

function pullJson(over: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      number: 7,
      title: 'Sipariş servisi',
      body: 'Açıklama',
      html_url: 'https://github.com/acme/shop/pull/7',
      user: { login: 'ayse' },
      base: { ref: 'main', sha: mainSha },
      head: { ref: 'feature', sha: featureSha },
      ...over,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** github.com/acme/shop adresini yerel bare depoya yönlendiren global git yapılandırması. */
function redirectGithubToBare(): void {
  const cfg = join(root, `gitconfig-${Math.random().toString(36).slice(2, 8)}`);
  writeFileSync(cfg, `[url "${bare.replace(/\\/g, '/')}"]\n\tinsteadOf = https://github.com/acme/shop.git\n`);
  vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
}

describe('createGithubChangeSet: depo modu', () => {
  it('base/head dalları: merge-base diff, iki taraf içerik, listFiles, info', async () => {
    const cacheDir = newCacheDir();
    const progress: string[] = [];
    const cs = track(await createGithubChangeSet({ url: bare, base: 'main', head: 'feature', cacheDir, onProgress: (m) => progress.push(m) }));
    expect(cs.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ['src/A.java', 'modified'],
      ['src/C.java', 'added'],
    ]);
    expect(await cs.readFile('old', 'src/A.java')).toBe('class A {}\n');
    expect(await cs.readFile('new', 'src/A.java')).toBe('class A { int x; }\n');
    // diff dışı dosya: head ağacından (main'deki c2 değil)
    expect(await cs.readFile('new', 'src/B.java')).toBe('class B {}\n');
    expect(await cs.listFiles('new', '.java')).toEqual(['src/A.java', 'src/B.java', 'src/C.java']);
    expect(cs.info).toMatchObject({
      kind: 'github',
      title: 'acme/shop: main...feature',
      baseRef: 'main',
      headRef: 'feature',
      headSha: featureSha,
      stableKey: 'github:local/acme/shop:main...feature',
    });
    expect(cs.info.repoPath).toBeUndefined();
    expect(cs.info.prNumber).toBeUndefined();
    expect(JSON.stringify(cs.info)).not.toContain(cacheDir);
    expect(cs.warnings).toEqual([]);
    expect(progress[0]).toBe('Depo önbelleği hazırlanıyor: acme/shop');
    expect(progress.join('\n')).not.toMatch(/[0-9a-f]{40}/); // iç SHA'lar insan-okur adlara çevrilir
  });

  it('base verilmezse uzak varsayılan dal (HEAD → main)', async () => {
    const cs = track(await createGithubChangeSet({ url: bare, head: 'feature', cacheDir: newCacheDir() }));
    expect(cs.info.baseRef).toBe('main');
    expect(cs.files).toHaveLength(2);
  });

  it('çalışma ağacına dosya checkout edilmez: önbellek klasöründe yalnız .git', async () => {
    const cacheDir = newCacheDir();
    track(await createGithubChangeSet({ url: bare, base: 'main', head: 'feature', cacheDir }));
    const dir = repoDirFor(cacheDir, parseRemoteSpec(bare));
    expect(readdirSync(dir)).toEqual(['.git']);
    expect(git(dir, 'config', 'remote.origin.url').trim()).toBe(bare);
  });

  it('ikinci çağrı önbelleği yeniden kullanır; uzak depodaki yeni commit görülür', async () => {
    const cacheDir = newCacheDir();
    const first = await createGithubChangeSet({ url: bare, base: 'main', head: 'feature', cacheDir });
    await first.dispose();
    const dir = repoDirFor(cacheDir, parseRemoteSpec(bare));
    const marker = join(dir, '.git', 'reviewist-test-marker');
    writeFileSync(marker, 'x');

    git(work, 'checkout', '-q', 'feature');
    write(work, 'src/C.java', 'class C { void yeni() {} }\n');
    git(work, 'commit', '-q', '-am', 'f2');
    const f2 = git(work, 'rev-parse', 'HEAD').trim();
    git(work, 'checkout', '-q', 'main');
    git(work, 'push', '-q', bare, 'feature');
    cleanups.push(() => {
      // Sonraki testler için feature'ı f1'e geri al
      git(work, 'push', '-q', '-f', bare, `${featureSha}:refs/heads/feature`);
    });

    const second = track(await createGithubChangeSet({ url: bare, base: 'main', head: 'feature', cacheDir }));
    expect(existsSync(marker)).toBe(true); // aynı depo klasörü, yeniden klonlanmadı
    expect(second.info.headSha).toBe(f2);
    expect(await second.readFile('new', 'src/C.java')).toBe('class C { void yeni() {} }\n');
  });

  it('eşzamanlı iki istek aynı depoda sırayla getirir', async () => {
    const cacheDir = newCacheDir();
    const [a, b] = await Promise.all([
      createGithubChangeSet({ url: bare, base: 'main', head: 'feature', cacheDir }),
      createGithubChangeSet({ url: bare, base: 'main', head: 'v1', cacheDir }),
    ]);
    track(a);
    track(b);
    expect(a.info.headSha).toBe(featureSha);
    expect(b.info.headSha).toBe(featureSha);
  });

  it('etiket ve SHA ile head', async () => {
    const tag = track(await createGithubChangeSet({ url: bare, base: 'main', head: 'v1', cacheDir: newCacheDir() }));
    expect(tag.info).toMatchObject({ headRef: 'v1', headSha: featureSha, title: 'acme/shop: main...v1' });
    expect(tag.files).toHaveLength(2);

    // Tam SHA: önbellekte yokken doğrudan istenir
    const cacheDir = newCacheDir();
    const full = track(await createGithubChangeSet({ url: bare, base: 'main', head: featureSha, cacheDir }));
    expect(full.info).toMatchObject({ headRef: featureSha, headSha: featureSha });
    expect(full.files).toHaveLength(2);
    const dir = repoDirFor(cacheDir, parseRemoteSpec(bare));
    expect(git(dir, 'rev-parse', `refs/reviewist/sha/${featureSha}`).trim()).toBe(featureSha);

    // Kısa SHA: önbellekte varsa çözülür
    const short = track(await createGithubChangeSet({ url: bare, base: 'main', head: featureSha.slice(0, 8), cacheDir }));
    expect(short.info.headSha).toBe(featureSha);
  });

  it('kısa SHA önbellekte yoksa Türkçe hata (head)', async () => {
    const err = await failure(createGithubChangeSet({ url: bare, base: 'main', head: featureSha.slice(0, 9), cacheDir: newCacheDir() }));
    expect(err).toMatchObject({ status: 400, field: 'head' });
    expect(err.message).toContain('tam (40 haneli) SHA');
  });
});

describe('createGithubChangeSet: PR modu', () => {
  it('github.com PR adresi: PR bilgisi tek API isteğiyle, kod git ile', async () => {
    redirectGithubToBare();
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url === 'https://api.github.com/repos/acme/shop/pulls/7' ? pullJson() : new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const cacheDir = newCacheDir();
    const cs = track(await createGithubChangeSet({ url: 'https://github.com/acme/shop/pull/7', cacheDir }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cs.info).toMatchObject({
      kind: 'github',
      title: '#7: Sipariş servisi',
      baseRef: 'main',
      headRef: 'feature',
      headSha: featureSha,
      prNumber: 7,
      prUrl: 'https://github.com/acme/shop/pull/7',
      author: 'ayse',
      description: 'Açıklama',
      stableKey: 'github:github.com/acme/shop#7',
    });
    expect(cs.info.repoPath).toBeUndefined();
    expect(cs.files.map((f) => f.path).sort()).toEqual(['src/A.java', 'src/C.java']);
    expect(cs.warnings).toEqual([]);
    const dir = repoDirFor(cacheDir, parseRemoteSpec('acme/shop'));
    expect(git(dir, 'rev-parse', 'refs/reviewist/pr/7').trim()).toBe(featureSha);
  });

  it('PR bilgisi alınamazsa uyarı; taban varsayılan daldan ya da verilen base', async () => {
    redirectGithubToBare();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })));
    const cs = track(await createGithubChangeSet({ url: 'acme/shop#7', cacheDir: newCacheDir() }));
    expect(cs.info).toMatchObject({ title: 'acme/shop#7', baseRef: 'main', headRef: 'pull/7/head', headSha: featureSha, prNumber: 7 });
    expect(cs.warnings.some((w) => w.includes('PR bulunamadı (404)'))).toBe(true);

    const withBase = track(await createGithubChangeSet({ url: 'acme/shop#7', base: 'main', cacheDir: newCacheDir() }));
    expect(withBase.info.baseRef).toBe('main');
    expect(withBase.files).toHaveLength(2);
  });

  it('PR başı API ile getirilen commit farklıysa "PR güncellenmiş olabilir" uyarısı', async () => {
    redirectGithubToBare();
    vi.stubGlobal('fetch', vi.fn(async () => pullJson({ head: { ref: 'feature', sha: 'd'.repeat(40) } })));
    const cs = track(await createGithubChangeSet({ url: 'acme/shop#7', cacheDir: newCacheDir() }));
    expect(cs.warnings.some((w) => w.startsWith('PR güncellenmiş olabilir'))).toBe(true);
  });

  it("yerel test deposunda PR (#n): API'siz, varsayılan dal tabanı", async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const cs = track(await createGithubChangeSet({ url: `${bare}#7`, cacheDir: newCacheDir() }));
    expect(spy).not.toHaveBeenCalled();
    expect(cs.info).toMatchObject({ baseRef: 'main', headSha: featureSha, stableKey: 'github:local/acme/shop#7' });
    expect(cs.warnings).toEqual([]);
  });

  it('PR head verilirse PR başının yerine geçer', async () => {
    const cs = track(await createGithubChangeSet({ url: `${bare}#7`, head: 'main', base: 'main', cacheDir: newCacheDir() }));
    expect(cs.info.headRef).toBe('main');
    expect(cs.files).toEqual([]);
  });
});

describe('createGithubChangeSet: hatalar', () => {
  it('olmayan dal / taban / PR / depo: Türkçe ileti + alan', async () => {
    const cacheDir = newCacheDir();
    const h = await failure(createGithubChangeSet({ url: bare, base: 'main', head: 'yok-dal', cacheDir }));
    expect(h).toMatchObject({ status: 400, field: 'head' });
    expect(h.message).toContain("bulunamadı: 'yok-dal'");
    const b = await failure(createGithubChangeSet({ url: bare, base: 'yok-taban', head: 'feature', cacheDir }));
    expect(b).toMatchObject({ status: 400, field: 'base' });
    expect(b.message).toContain('Taban dal');
    const p = await failure(createGithubChangeSet({ url: `${bare}#99`, cacheDir }));
    expect(p).toMatchObject({ field: 'url' });
    expect(p.message).toContain('PR bulunamadı');
    const r = await failure(createGithubChangeSet({ url: join(root, 'remotes', 'acme', 'yok.git'), head: 'x', cacheDir }));
    expect(r).toMatchObject({ status: 404, field: 'url' });
    expect(r.message).toContain('Depo bulunamadı');
  });

  it('geçersiz ref adları ve eksik head: önbelleğe dokunmadan 400', async () => {
    const cacheDir = newCacheDir();
    for (const head of ['-x', 'a..b', 'a b', 'a:b', 'a^', 'a~1', 'a?', 'a*', 'a[', 'a\\b', 'a@{1}', '.gizli', 'x.lock']) {
      const e = await failure(createGithubChangeSet({ url: bare, base: 'main', head, cacheDir }));
      expect(e, head).toMatchObject({ status: 400, field: 'head' });
    }
    const eb = await failure(createGithubChangeSet({ url: bare, base: '--upload-pack=x', head: 'feature', cacheDir }));
    expect(eb).toMatchObject({ status: 400, field: 'base' });
    const missing = await failure(createGithubChangeSet({ url: bare, cacheDir }));
    expect(missing).toMatchObject({ status: 400, field: 'head' });
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('kanca kapalıyken yerel adres reddedilir; insteadOf ile yerel depoya yönlendirme git tarafından engellenir', async () => {
    vi.stubEnv('REVIEWIST_ALLOW_FILE_REMOTE', '');
    await expect(createGithubChangeSet({ url: bare, head: 'feature', cacheDir: newCacheDir() })).rejects.toMatchObject({ field: 'url' });
    redirectGithubToBare();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const e = await failure(createGithubChangeSet({ url: 'https://github.com/acme/shop', head: 'feature', cacheDir: newCacheDir() }));
    expect(e).toMatchObject({ status: 400, code: 'BAD_URL', field: 'url' });
  });
});

describe('yardımcılar', () => {
  it('assertRefName: geçerli adlar', () => {
    for (const ok of ['main', 'feature/x', 'release/1.0', 'v1.2.3', 'user_name-1', 'ğüş']) expect(() => assertRefName(ok, 'base')).not.toThrow();
  });

  it('encodeRefPart', () => {
    expect(encodeRefPart('release/1.0')).toBe('release%2F1.0');
    expect(encodeRefPart('a%2Fb')).toBe('a%252Fb');
  });

  it('parseLsRemote', () => {
    const sha = 'a'.repeat(40);
    expect(parseLsRemote(`ref: refs/heads/trunk\tHEAD\n${sha}\tHEAD\n${sha}\trefs/heads/trunk\n`)).toEqual({
      defaultBranch: 'trunk',
      refs: new Map([
        ['HEAD', sha],
        ['refs/heads/trunk', sha],
      ]),
    });
    expect(parseLsRemote('')).toEqual({ refs: new Map() });
  });

  it('mapRemoteGitError: kimlik, bulunamadı, ağ', () => {
    const remote = parseRemoteSpec('https://github.com/acme/shop', {});
    const auth = [
      'fatal: could not read Username for \'https://github.com\': terminal prompts disabled',
      'remote: Invalid username or password.\nfatal: Authentication failed for \'https://github.com/acme/shop.git/\'',
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
    ];
    for (const s of auth) {
      const e = mapRemoteGitError(s, 128, remote);
      expect(e).toMatchObject({ code: 'GITHUB_AUTH', field: 'url' });
      expect(e.message).toContain('kimlik doğrulaması gerekli');
      expect(e.message).toContain('git ls-remote https://github.com/acme/shop.git');
    }
    expect(mapRemoteGitError("remote: Repository not found.\nfatal: repository 'https://github.com/acme/shop.git/' not found", 128, remote)).toMatchObject({
      code: 'GITHUB_NOT_FOUND',
      status: 404,
    });
    expect(mapRemoteGitError("fatal: couldn't find remote ref refs/heads/x", 128, remote, 'base')).toMatchObject({ field: 'base' });
    expect(mapRemoteGitError("fatal: unable to access 'https://github.com/acme/shop.git/': Could not resolve host: github.com", 128, remote)).toMatchObject({
      code: 'GITHUB_FAILED',
      status: 502,
    });
    expect(mapRemoteGitError('bilinmeyen', 1, remote).message).toContain('başarısız');
  });
});

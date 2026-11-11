import { isAbsolute, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoDirFor, resolveCacheDir, safeSegment, withRepoLock } from './cache.js';

describe('resolveCacheDir', () => {
  it('--cache-dir → REVIEWIST_CACHE_DIR → platform varsayılanı', () => {
    const home = resolve('/ev/kullanici');
    expect(resolveCacheDir('x/y', { env: { REVIEWIST_CACHE_DIR: '/z' }, home })).toBe(resolve('x/y'));
    expect(resolveCacheDir('~/onbellek', { env: {}, home })).toBe(join(home, 'onbellek'));
    expect(resolveCacheDir(undefined, { env: { REVIEWIST_CACHE_DIR: resolve('/z') }, home })).toBe(resolve('/z'));
    expect(resolveCacheDir('  ', { env: { REVIEWIST_CACHE_DIR: resolve('/z') }, home })).toBe(resolve('/z'));
    expect(resolveCacheDir(undefined, { env: {}, platform: 'darwin', home })).toBe(join(home, 'Library', 'Caches', 'reviewist-github'));
    expect(resolveCacheDir(undefined, { env: { LOCALAPPDATA: resolve('/la') }, platform: 'win32', home })).toBe(
      join(resolve('/la'), 'reviewist-github', 'cache'),
    );
    expect(resolveCacheDir(undefined, { env: {}, platform: 'win32', home })).toBe(join(home, 'AppData', 'Local', 'reviewist-github', 'cache'));
    expect(resolveCacheDir(undefined, { env: { XDG_CACHE_HOME: resolve('/xdg') }, platform: 'linux', home })).toBe(
      join(resolve('/xdg'), 'reviewist-github'),
    );
    expect(resolveCacheDir(undefined, { env: { XDG_CACHE_HOME: 'goreli' }, platform: 'linux', home })).toBe(
      join(home, '.cache', 'reviewist-github'),
    );
    expect(resolveCacheDir(undefined, { env: {}, platform: 'linux', home })).toBe(join(home, '.cache', 'reviewist-github'));
  });
});

describe('repoDirFor', () => {
  const cache = resolve('/onbellek');

  it('<cache>/repos/<host>/<sahip>/<depo>, küçük harf', () => {
    expect(repoDirFor(cache, { host: 'GitHub.com', owner: 'Acme', repo: 'Shop.Api' })).toBe(
      join(cache, 'repos', 'github.com', 'acme', 'shop.api'),
    );
    expect(repoDirFor(cache, { host: 'ghe.example:8443', owner: 'a', repo: 'b' })).toBe(join(cache, 'repos', 'ghe.example_8443', 'a', 'b'));
  });

  it('yol kaçışı imkânsız', () => {
    const root = join(cache, 'repos');
    const evil = ['..', '.', '../..', '..\\..', '/etc', 'C:\\x', 'a/../../b', '', '.git', 'con', 'x.', '\0', 'ü'];
    for (const h of evil) {
      for (const o of evil) {
        const dir = repoDirFor(cache, { host: h, owner: o, repo: 'r' });
        const rel = relative(root, dir);
        expect(rel.startsWith('..') || isAbsolute(rel), `${h}/${o}`).toBe(false);
        expect(rel.split(/[\\/]/)).toHaveLength(3);
      }
    }
    expect(safeSegment('..')).toBe('_.._');
    expect(safeSegment('.git')).toBe('_.git');
    expect(safeSegment('a/b\\c')).toBe('a_b_c');
    expect(safeSegment('NUL')).toBe('_nul');
    expect(safeSegment('x.')).toBe('x._');
  });
});

describe('withRepoLock', () => {
  it('aynı depoda işler sırayla, farklı depolarda paralel; hata kilidi bozmaz', async () => {
    const log: string[] = [];
    const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const job = (dir: string, name: string, ms: number, fail = false) =>
      withRepoLock(dir, async () => {
        log.push(`${name}+`);
        await delay(ms);
        log.push(`${name}-`);
        if (fail) throw new Error(name);
        return name;
      });
    const a = resolve('/c/repos/a');
    const b = resolve('/c/repos/b');
    const results = await Promise.allSettled([job(a, 'a1', 30, true), job(a, 'a2', 5), job(b, 'b1', 10), job(a.toUpperCase(), 'a3', 1)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
    const aLog = log.filter((l) => l.startsWith('a'));
    expect(aLog).toEqual(
      process.platform === 'linux' ? ['a1+', 'a3+', 'a3-', 'a1-', 'a2+', 'a2-'] : ['a1+', 'a1-', 'a2+', 'a2-', 'a3+', 'a3-'],
    );
    // b, a1 bitmeden başladı (farklı depo)
    expect(log.indexOf('b1+')).toBeLessThan(log.indexOf('a1-'));
  });
});

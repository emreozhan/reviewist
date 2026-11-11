import { describe, expect, it } from 'vitest';
import { SourceError } from '../../shared/src/sources/errors.js';
import { ONLY_GITHUB_MESSAGE, parseGithubRequest } from './request.js';

describe('parseGithubRequest', () => {
  it('geçerli istekler (değerler kırpılır)', () => {
    expect(parseGithubRequest({ kind: 'github', url: ' acme/shop#7 ' })).toEqual({ kind: 'github', url: 'acme/shop#7' });
    expect(parseGithubRequest({ kind: 'github', url: 'acme/shop', base: 'main', head: 'feature/x' })).toEqual({
      kind: 'github',
      url: 'acme/shop',
      base: 'main',
      head: 'feature/x',
    });
    expect(parseGithubRequest({ kind: 'github', url: 'acme/shop', head: 'abcdef1' }).head).toBe('abcdef1');
  });

  it('yerel istek türleri yönlendirici iletiyle reddedilir', () => {
    for (const kind of ['git', 'worktree', 'patch', 'bilinmeyen']) {
      expect(() => parseGithubRequest({ kind, url: 'acme/shop' })).toThrow(ONLY_GITHUB_MESSAGE);
    }
    expect(() => parseGithubRequest({ url: 'acme/shop' })).toThrow(/Reviewist Yerel/);
  });

  it('alan hataları: url, head, base', () => {
    const field = (body: unknown): string | undefined => {
      try {
        parseGithubRequest(body);
      } catch (err) {
        expect(err).toBeInstanceOf(SourceError);
        return (err as SourceError).field;
      }
      return undefined;
    };
    expect(field({ kind: 'github', url: '' })).toBe('url');
    expect(field({ kind: 'github', url: 'http://github.com/a/b' })).toBe('url');
    expect(field({ kind: 'github', url: 'acme/shop' })).toBe('head');
    expect(field({ kind: 'github', url: 'acme/shop', head: '-x' })).toBe('head');
    expect(field({ kind: 'github', url: 'acme/shop#1', base: 'a..b' })).toBe('base');
    expect(field({ kind: 'github', url: 5 })).toBe('url');
    expect(field(null)).toBeUndefined();
    expect(() => parseGithubRequest([])).toThrow(/JSON nesnesi/);
  });
});

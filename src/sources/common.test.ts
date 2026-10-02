import { describe, expect, it } from 'vitest';
import {
  githubStableKey,
  gitStableKey,
  normalizeRepoKeyPath,
  patchStableKey,
  sanitizeRepoRelPath,
  worktreeStableKey,
} from './common.js';

describe('sanitizeRepoRelPath', () => {
  it('göreli yolları normalize eder', () => {
    expect(sanitizeRepoRelPath('src/A.java')).toBe('src/A.java');
    expect(sanitizeRepoRelPath('./src//A.java')).toBe('src/A.java');
    expect(sanitizeRepoRelPath('src\\main\\A.java')).toBe('src/main/A.java');
    expect(sanitizeRepoRelPath('src/./A.java')).toBe('src/A.java');
    expect(sanitizeRepoRelPath('dosya..adı.txt')).toBe('dosya..adı.txt');
    expect(sanitizeRepoRelPath('Türkçe Sınıf.java')).toBe('Türkçe Sınıf.java');
  });

  it("'..', mutlak yol, sürücü harfi, UNC, NUL ve boş yolu reddeder", () => {
    for (const bad of [
      '',
      '.',
      './',
      '..',
      '../x',
      'a/../../x',
      'a/..',
      'a\\..\\..\\x',
      '/etc/passwd',
      '\\\\server\\share\\x',
      '\\x',
      'C:\\Windows\\win.ini',
      'C:/x',
      'c:x',
      'a\0b',
      'a\nb',
    ]) {
      expect(sanitizeRepoRelPath(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });
});

describe('stableKey', () => {
  it('git / worktree: depo yolu normalize edilir', () => {
    const repo = process.platform === 'win32' ? 'C:\\Repo\\Shop\\' : '/repo/shop/';
    const norm = process.platform === 'win32' ? 'c:/repo/shop' : '/repo/shop';
    expect(normalizeRepoKeyPath(repo)).toBe(norm);
    expect(gitStableKey(repo, 'main', 'feature/x', 'mergeBase')).toBe(`git:${norm}:main...feature/x:mergeBase`);
    expect(gitStableKey(repo, 'main', 'feature/x', 'range')).toBe(`git:${norm}:main...feature/x:range`);
    expect(worktreeStableKey(repo, 'HEAD')).toBe(`worktree:${norm}:HEAD`);
  });

  it('github: küçük harf', () => {
    expect(githubStableKey('GitHub.com', 'Acme', 'Shop', 7)).toBe('github:github.com/acme/shop#7');
  });

  it('patch: sha1 ilk 12, CRLF normalize', () => {
    // sha1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d
    expect(patchStableKey('abc')).toBe('patch:a9993e364706');
    expect(patchStableKey('a\r\nb')).toBe(patchStableKey('a\nb'));
  });
});

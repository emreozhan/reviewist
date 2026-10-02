import { describe, expect, it } from 'vitest';
import {
  githubStableKey,
  isBinaryContent,
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

describe('isBinaryContent', () => {
  const nulJava = (): Buffer => {
    // commons-lang ClassUtilsOssFuzzTest.java benzeri: dize sabitlerinde çok sayıda NUL, geçerli UTF-8.
    const body = 'class F {\n  String s = "' + 'a\u0000\u0000b\u0000'.repeat(400) + 'ş";\n}\n';
    return Buffer.from(body, 'utf8');
  };

  it('NUL yoksa metin', () => {
    expect(isBinaryContent(Buffer.from('class A {}\n'), 'A.java')).toBe(false);
    expect(isBinaryContent(Buffer.from('a,b\n'), 'x.csv')).toBe(false);
  });

  it('NUL içeren ama geçerli UTF-8 .java metin sayılır; başka uzantıda ikili', () => {
    expect(isBinaryContent(nulJava(), 'src/F.java')).toBe(false);
    expect(isBinaryContent(nulJava(), 'src/F.JAVA')).toBe(false);
    expect(isBinaryContent(nulJava(), 'res/f.dat')).toBe(true);
    expect(isBinaryContent(nulJava(), undefined)).toBe(true);
  });

  it('.java uzantılı gerçek ikili (geçersiz UTF-8 yoğun) ikili sayılır', () => {
    const bytes = Buffer.alloc(4000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 151 + 7) % 256; // NUL + 0x80-0xff karışık
    expect(isBinaryContent(bytes, 'Bozuk.java')).toBe(true);
  });

  it('UTF-16 kodlu .java ikili sayılır (UTF-8 olarak okunamaz)', () => {
    expect(isBinaryContent(Buffer.from('class A { int x; }\n'.repeat(20), 'utf16le'), 'A.java')).toBe(true);
  });

  it('8000 bayt sınırında kesilen çok baytlı karakter geçersiz sayılmaz', () => {
    const s = Buffer.concat([Buffer.from('\u0000' + 'x'.repeat(7997)), Buffer.from('ğğ', 'utf8')]);
    expect(isBinaryContent(s, 'A.java')).toBe(false);
  });
});

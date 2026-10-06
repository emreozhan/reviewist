import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expandHome,
  githubStableKey,
  isBinaryContent,
  isNetworkPath,
  isOsJunkFile,
  gitStableKey,
  normalizeRepoKeyPath,
  patchStableKey,
  readRepoFile,
  sanitizeRepoRelPath,
  worktreeStableKey,
} from './common.js';

describe('sanitizeRepoRelPath', () => {
  it('göreli yolları normalize eder', () => {
    expect(sanitizeRepoRelPath('src/A.java')).toBe('src/A.java');
    expect(sanitizeRepoRelPath('./src//A.java')).toBe('src/A.java');
    expect(sanitizeRepoRelPath('src\\main\\A.java', 'win32')).toBe('src/main/A.java');
    // POSIX'te ters eğik çizgi ve `:` dosya adının parçasıdır
    expect(sanitizeRepoRelPath('src\\main\\A.java', 'linux')).toBe('src\\main\\A.java');
    expect(sanitizeRepoRelPath('a:b.java', 'darwin')).toBe('a:b.java');
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
      expect(sanitizeRepoRelPath(bad, 'win32'), JSON.stringify(bad)).toBeUndefined();
    }
    // Her platformda reddedilenler
    for (const bad of ['', '..', '../x', 'a/../../x', '/etc/passwd', 'a\0b', 'a\nb']) {
      expect(sanitizeRepoRelPath(bad, 'linux'), JSON.stringify(bad)).toBeUndefined();
    }
  });
});

describe('expandHome / isOsJunkFile / readRepoFile', () => {
  it('~ ve ~/ ev dizinine açılır, diğer yollar olduğu gibi kalır', () => {
    expect(expandHome('~', '/home/u')).toBe('/home/u');
    expect(expandHome('~/code/shop', '/home/u')).toBe(join('/home/u', 'code/shop'));
    expect(expandHome('~\\code', 'C:\\Users\\u')).toBe(join('C:\\Users\\u', 'code'));
    expect(expandHome('/opt/x', '/home/u')).toBe('/opt/x');
    expect(expandHome('~user/x', '/home/u')).toBe('~user/x');
  });

  it('işletim sistemi çöp dosyalarını tanır', () => {
    for (const p of ['.DS_Store', 'src/.DS_Store', 'src/._Foo.java', 'Thumbs.db', 'x/desktop.ini']) expect(isOsJunkFile(p), p).toBe(true);
    for (const p of ['src/Foo.java', 'src/_Foo.java', '.gitignore', 'a/.env']) expect(isOsJunkFile(p), p).toBe(false);
  });

  it('depo dosyasını okur; sembolik bağı izlemez; kök dışına çıkmaz', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'reviewist-readrepo-')));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'A.java'), 'class A {}');
      writeFileSync(join(root, 'secret.txt'), 'gizli');
      expect((await readRepoFile(root, 'src/A.java'))?.toString()).toBe('class A {}');
      expect(await readRepoFile(root, 'src')).toBeUndefined(); // klasör
      expect(await readRepoFile(root, '../secret.txt')).toBeUndefined();
      expect(await readRepoFile(root, 'yok.java')).toBeUndefined();
      let linked = false;
      try {
        symlinkSync(join(root, 'secret.txt'), join(root, 'src', 'Link.java'), 'file');
        linked = true;
      } catch {
        /* Windows'ta sembolik bağ izni olmayabilir */
      }
      if (linked) {
        // git'in gördüğü gibi: bağın hedef yolu, hedef dosyanın içeriği değil
        const got = (await readRepoFile(root, 'src/Link.java'))?.toString();
        expect(got).not.toBe('gizli');
        expect(got).toContain('secret.txt');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
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

describe('isNetworkPath', () => {
  it('UNC ve uzun UNC yollarını ağ yolu sayar', () => {
    for (const p of ['\\\\sunucu\\pay', '//sunucu/pay', '\\\\?\\UNC\\sunucu\\pay', '  \\\\evil\\x']) expect(isNetworkPath(p, 'win32')).toBe(true);
    // POSIX'te `//x` yerel bir yoldur; SMB riski yoktur
    expect(isNetworkPath('//sunucu/pay', 'darwin')).toBe(false);
    expect(isNetworkPath('\\\\sunucu\\pay', 'linux')).toBe(false);
  });

  it('yerel yolları kabul eder', () => {
    for (const p of ['C:\\Users\\a', 'C:/repo', '/home/a', 'repo', '.\\x']) expect(isNetworkPath(p, 'win32')).toBe(false);
  });
});

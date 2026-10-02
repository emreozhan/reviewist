import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPatchChangeSet } from './patch.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() ?? '', { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const V1 = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const V2 = V1.replace('line 3\n', 'line 3 changed\nline 3b\n').replace('line 30\n', '').replace(/line 40\n$/, 'line 40 son');

describe('createPatchChangeSet', () => {
  it('git diff çıktısını yeni içerikten geri uygulayarak eski içeriği türetir', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'reviewist-patch-'));
    dirs.push(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.name', 'T');
    git(repo, 'config', 'user.email', 't@example.com');
    git(repo, 'config', 'core.autocrlf', 'false');
    write(repo, 'src/A.txt', V1);
    write(repo, 'src/Old.java', 'class Old {\n  int a;\n  int b;\n  int c;\n}\n');
    write(repo, 'src/Gone.java', 'class Gone {\n}\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'v1');
    write(repo, 'src/A.txt', V2);
    git(repo, 'mv', 'src/Old.java', 'src/Yeni.java');
    write(repo, 'src/Yeni.java', 'class Old {\n  int a;\n  int b;\n  int c2;\n}\n');
    rmSync(join(repo, 'src/Gone.java'));
    write(repo, 'src/Ek.java', 'class Ek {}\n');
    git(repo, 'add', '-A');
    const text = git(repo, 'diff', '--cached', '-M', '--src-prefix=a/', '--dst-prefix=b/');

    const cs = await createPatchChangeSet({ text, repoPath: repo });
    expect(cs.info.kind).toBe('patch');
    expect(cs.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ['src/A.txt', 'modified'],
      ['src/Ek.java', 'added'],
      ['src/Gone.java', 'deleted'],
      ['src/Yeni.java', 'renamed'],
    ]);
    expect(await cs.readFile('new', 'src/A.txt')).toBe(V2);
    expect(await cs.readFile('old', 'src/A.txt')).toBe(V1);
    expect(await cs.readFile('old', 'src/Yeni.java')).toBe('class Old {\n  int a;\n  int b;\n  int c;\n}\n');
    expect(await cs.readFile('old', 'src/Old.java')).toBe('class Old {\n  int a;\n  int b;\n  int c;\n}\n');
    expect(await cs.readFile('old', 'src/Gone.java')).toBe('class Gone {\n}\n');
    expect(await cs.readFile('new', 'src/Gone.java')).toBeUndefined();
    expect(await cs.readFile('old', 'src/Ek.java')).toBeUndefined();
    expect(await cs.readFile('new', 'src/Ek.java')).toBe('class Ek {}\n');
    expect(await cs.listFiles('new', '.java')).toEqual([]);
  });

  it('disk içeriği yamayla uyuşmazsa eski taraf undefined', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reviewist-patch-'));
    dirs.push(root);
    write(root, 'A.txt', 'tamamen\nfarklı\n');
    const text = ['--- a/A.txt', '+++ b/A.txt', '@@ -1,2 +1,2 @@', ' x', '-y', '+z', ''].join('\n');
    const cs = await createPatchChangeSet({ text, repoPath: root });
    expect(await cs.readFile('new', 'A.txt')).toBe('tamamen\nfarklı\n');
    expect(await cs.readFile('old', 'A.txt')).toBeUndefined();
  });

  it('repoPath yoksa readFile undefined, listFiles []; Subject başlık olur', async () => {
    const text = [
      'Subject: [PATCH 1/1] Sipariş akışı düzeltildi',
      '',
      'diff --git a/A.java b/A.java',
      '--- a/A.java',
      '+++ b/A.java',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');
    const cs = await createPatchChangeSet({ text });
    expect(cs.info.title).toBe('Sipariş akışı düzeltildi');
    expect(cs.files).toHaveLength(1);
    expect(await cs.readFile('new', 'A.java')).toBeUndefined();
    expect(await cs.readFile('old', 'A.java')).toBeUndefined();
    expect(await cs.listFiles('new')).toEqual([]);
  });

  it('depo dışına çıkan yol okunmaz; boş yama uyarı üretir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reviewist-patch-'));
    dirs.push(root);
    const text = ['--- a/../escape.txt', '+++ b/../escape.txt', '@@ -1 +1 @@', '-a', '+b'].join('\n');
    const cs = await createPatchChangeSet({ text, repoPath: root });
    expect(await cs.readFile('new', '../escape.txt')).toBeUndefined();
    const empty = await createPatchChangeSet({ text: 'yalnızca metin' });
    expect(empty.files).toEqual([]);
    expect(empty.warnings[0]).toContain('bulunamadı');
  });

  it('repoPath olmadan: eklenen dosyanın yeni, silinen dosyanın eski içeriği hunk\'lardan kurulur', async () => {
    const text = [
      'diff --git a/src/Ek.java b/src/Ek.java',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/Ek.java',
      '@@ -0,0 +1,3 @@',
      '+class Ek {',
      '+  int a;',
      '+}',
      'diff --git a/src/Gone.java b/src/Gone.java',
      'deleted file mode 100644',
      '--- a/src/Gone.java',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-class Gone {',
      '-}',
      '\\ No newline at end of file',
      'diff --git a/src/Mod.java b/src/Mod.java',
      '--- a/src/Mod.java',
      '+++ b/src/Mod.java',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    const progress: string[] = [];
    const cs = await createPatchChangeSet({ text, onProgress: (m) => progress.push(m) });
    expect(progress).toEqual(['Yama ayrıştırılıyor', 'Yama ayrıştırıldı: 3 dosya']);
    expect(await cs.readFile('new', 'src/Ek.java')).toBe('class Ek {\n  int a;\n}\n');
    expect(await cs.readFile('old', 'src/Ek.java')).toBeUndefined();
    expect(await cs.readFile('old', 'src/Gone.java')).toBe('class Gone {\n}');
    expect(await cs.readFile('new', 'src/Gone.java')).toBeUndefined();
    // Değişen dosyanın tam içeriği yamadan bilinemez
    expect(await cs.readFile('new', 'src/Mod.java')).toBeUndefined();
    expect(await cs.readFile('old', 'src/Mod.java')).toBeUndefined();
    expect(await cs.readFile('new', '../src/Ek.java')).toBeUndefined();
  });

  it('kesilmiş ekleme yaması (satır sayısı uyuşmaz) içerik üretmez', async () => {
    const text = ['--- /dev/null', '+++ b/A.txt', '@@ -0,0 +1,5 @@', '+a', '+b', ''].join('\n');
    const cs = await createPatchChangeSet({ text });
    expect(cs.files[0]?.status).toBe('added');
    expect(await cs.readFile('new', 'A.txt')).toBeUndefined();
  });

  it('stableKey: metnin sha1 ilk 12 hanesi; CRLF/LF farkı anahtarı değiştirmez', async () => {
    const lf = ['--- a/A.txt', '+++ b/A.txt', '@@ -1 +1 @@', '-a', '+b', ''].join('\n');
    const a = await createPatchChangeSet({ text: lf });
    const b = await createPatchChangeSet({ text: lf.replace(/\n/g, '\r\n') });
    const c = await createPatchChangeSet({ text: lf.replace('+b', '+c') });
    expect(a.info.stableKey).toMatch(/^patch:[0-9a-f]{12}$/);
    expect(b.info.stableKey).toBe(a.info.stableKey);
    expect(c.info.stableKey).not.toBe(a.info.stableKey);
  });
});

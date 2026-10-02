import { describe, expect, it } from 'vitest';
import { hunksForAddedContent, parseHunks, parseUnifiedDiff, parseUnifiedDiffDetailed, unquoteGitPath } from './unifiedDiff.js';

describe('parseUnifiedDiff', () => {
  it('boş diff → []', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('\n\n')).toEqual([]);
  });

  it('değiştirilmiş dosya: satır numaraları ve sayaçlar', () => {
    const diff = [
      'diff --git a/src/A.java b/src/A.java',
      'index 1111111..2222222 100644',
      '--- a/src/A.java',
      '+++ b/src/A.java',
      '@@ -1,4 +1,5 @@ class A {',
      ' line1',
      '-line2',
      '+line2b',
      '+line2c',
      ' line3',
      ' line4',
      '@@ -10,2 +11,2 @@',
      '-x',
      '+y',
      ' z',
      '',
    ].join('\n');
    const [f] = parseUnifiedDiff(diff);
    expect(f).toBeDefined();
    if (!f) return;
    expect(f.path).toBe('src/A.java');
    expect(f.status).toBe('modified');
    expect(f.oldPath).toBeUndefined();
    expect(f.additions).toBe(3);
    expect(f.deletions).toBe(2);
    expect(f.hunks).toHaveLength(2);
    const h0 = f.hunks[0];
    expect(h0?.header).toBe('class A {');
    expect(h0?.lines).toEqual([
      { type: 'context', oldNo: 1, newNo: 1, text: 'line1' },
      { type: 'del', oldNo: 2, text: 'line2' },
      { type: 'add', newNo: 2, text: 'line2b' },
      { type: 'add', newNo: 3, text: 'line2c' },
      { type: 'context', oldNo: 3, newNo: 4, text: 'line3' },
      { type: 'context', oldNo: 4, newNo: 5, text: 'line4' },
    ]);
    expect(f.hunks[1]?.lines).toEqual([
      { type: 'del', oldNo: 10, text: 'x' },
      { type: 'add', newNo: 11, text: 'y' },
      { type: 'context', oldNo: 11, newNo: 12, text: 'z' },
    ]);
  });

  it('yeni dosya, silinen dosya, mod değişikliği', () => {
    const diff = [
      'diff --git a/New.java b/New.java',
      'new file mode 100644',
      'index 0000000..e69de29',
      '--- /dev/null',
      '+++ b/New.java',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/Old.java b/Old.java',
      'deleted file mode 100644',
      'index e69de29..0000000',
      '--- a/Old.java',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
      'diff --git a/run.sh b/run.sh',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/empty.txt b/empty.txt',
      'new file mode 100644',
      'index 0000000..e69de29',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['New.java', 'added', 2, 0],
      ['Old.java', 'deleted', 0, 1],
      ['run.sh', 'modified', 0, 0],
      ['empty.txt', 'added', 0, 0],
    ]);
    expect(files[0]?.hunks[0]?.lines[1]).toEqual({ type: 'add', newNo: 2, text: 'b' });
    expect(files[1]?.hunks[0]?.lines[0]).toEqual({ type: 'del', oldNo: 1, text: 'gone' });
  });

  it('rename (benzerlik %100, hunk yok) ve değişiklikli rename', () => {
    const diff = [
      'diff --git a/a/Foo.java b/b/Bar.java',
      'similarity index 100%',
      'rename from a/Foo.java',
      'rename to b/Bar.java',
      'diff --git a/x/Old.java b/y/New.java',
      'similarity index 90%',
      'rename from x/Old.java',
      'rename to y/New.java',
      'index 1..2 100644',
      '--- a/x/Old.java',
      '+++ b/y/New.java',
      '@@ -1,2 +1,2 @@',
      '-package x;',
      '+package y;',
      ' class C {}',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files[0]).toMatchObject({ path: 'b/Bar.java', oldPath: 'a/Foo.java', status: 'renamed', hunks: [] });
    expect(files[1]).toMatchObject({ path: 'y/New.java', oldPath: 'x/Old.java', status: 'renamed', additions: 1, deletions: 1 });
  });

  it('copy from/to', () => {
    const diff = [
      'diff --git a/A.java b/B.java',
      'similarity index 95%',
      'copy from A.java',
      'copy to B.java',
      '--- a/A.java',
      '+++ b/B.java',
      '@@ -1 +1 @@',
      '-class A {}',
      '+class B {}',
    ].join('\n');
    expect(parseUnifiedDiff(diff)[0]).toMatchObject({ path: 'B.java', oldPath: 'A.java', status: 'copied' });
  });

  it('binary: "Binary files differ" ve "GIT binary patch"', () => {
    const diff = [
      'diff --git a/img.png b/img.png',
      'index 1..2 100644',
      'Binary files a/img.png and b/img.png differ',
      'diff --git a/lib.jar b/lib.jar',
      'new file mode 100644',
      'index 0000000..abc',
      'GIT binary patch',
      'literal 12',
      'zcmZQzWMXDuWME{_',
      '',
      'literal 0',
      'HcmV?d00001',
      '',
      'diff --git a/A.java b/A.java',
      '--- a/A.java',
      '+++ b/A.java',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ['img.png', 'modified', true],
      ['lib.jar', 'added', true],
      ['A.java', 'modified', false],
    ]);
  });

  it('tırnaklı ve oktal kaçışlı yollar (core.quotepath)', () => {
    // "src/Çalışan.java" → Ç = \303\207, ı = \304\261, ş = \305\237
    const q = '"src/\\303\\207al\\304\\261\\305\\237an.java"';
    const diff = [
      `diff --git "a/src/\\303\\207al\\304\\261\\305\\237an.java" "b/src/\\303\\207al\\304\\261\\305\\237an.java"`,
      'index 1..2 100644',
      `--- "a/src/\\303\\207al\\304\\261\\305\\237an.java"`,
      `+++ "b/src/\\303\\207al\\304\\261\\305\\237an.java"`,
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git "a/with \\"quote\\".txt" "b/with \\"quote\\".txt"',
      'deleted file mode 100644',
      '--- "a/with \\"quote\\".txt"',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
    ].join('\n');
    expect(unquoteGitPath(q)).toBe('src/Çalışan.java');
    const files = parseUnifiedDiff(diff);
    expect(files[0]?.path).toBe('src/Çalışan.java');
    expect(files[1]).toMatchObject({ path: 'with "quote".txt', status: 'deleted' });
  });

  it('quotepath=false: ham UTF-8 ve boşluklu yollar (---/+++ olmadan)', () => {
    const diff = [
      'diff --git a/dir with space/Sınıf.java b/dir with space/Sınıf.java',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/eski ad.txt b/yeni ad.txt',
      'similarity index 100%',
      'rename from eski ad.txt',
      'rename to yeni ad.txt',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files[0]?.path).toBe('dir with space/Sınıf.java');
    expect(files[1]).toMatchObject({ path: 'yeni ad.txt', oldPath: 'eski ad.txt', status: 'renamed' });
  });

  it('"\\ No newline at end of file" satır sayımını bozmaz ve ham satırlarda korunur', () => {
    const diff = [
      'diff --git a/A.txt b/A.txt',
      '--- a/A.txt',
      '+++ b/A.txt',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '\\ No newline at end of file',
      '+c',
      '\\ No newline at end of file',
    ].join('\n');
    const [p] = parseUnifiedDiffDetailed(diff);
    expect(p?.file.hunks[0]?.lines).toEqual([
      { type: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { type: 'del', oldNo: 2, text: 'b' },
      { type: 'add', newNo: 2, text: 'c' },
    ]);
    expect(p?.rawHunks[0]?.lines).toEqual([' a', '-b', '\\ No newline at end of file', '+c', '\\ No newline at end of file']);
  });

  it('CRLF girdi', () => {
    const diff = ['diff --git a/A.java b/A.java', '--- a/A.java', '+++ b/A.java', '@@ -1,2 +1,2 @@', ' keep', '-old', '+new', ''].join('\r\n');
    const [f] = parseUnifiedDiff(diff);
    expect(f?.path).toBe('A.java');
    expect(f?.hunks[0]?.lines.map((l) => l.text)).toEqual(['keep', 'old', 'new']);
  });

  it('hunk içinde "--- " ile başlayan silinen satır yeni dosya sanılmaz', () => {
    const diff = [
      'diff --git a/A.sql b/A.sql',
      '--- a/A.sql',
      '+++ b/A.sql',
      '@@ -1,3 +1,2 @@',
      ' x',
      '--- yorum',
      '-++ y',
      '+z',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0]?.hunks[0]?.lines.map((l) => [l.type, l.text])).toEqual([
      ['context', 'x'],
      ['del', '-- yorum'],
      ['del', '++ y'],
      ['add', 'z'],
    ]);
  });

  it('düz patch (diff -u), /dev/null ve zaman damgası', () => {
    const diff = [
      'Only in a: x',
      '--- a/src/A.java\t2024-01-01 10:00:00.000000000 +0300',
      '+++ b/src/A.java\t2024-01-02 10:00:00.000000000 +0300',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '--- /dev/null',
      '+++ b/src/B.java',
      '@@ -0,0 +1 @@',
      '+new',
      '--- orig/C.java',
      '+++ C.java',
      '@@ -1 +1 @@',
      '-c',
      '+d',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/A.java', 'modified'],
      ['src/B.java', 'added'],
      ['C.java', 'modified'],
    ]);
  });

  it('format-patch e-postası (commit mesajı ve imza satırı yok sayılır)', () => {
    const diff = [
      'From 123 Mon Sep 17 00:00:00 2001',
      'Subject: [PATCH] Düzeltme',
      '',
      '---',
      ' A.java | 2 +-',
      '',
      'diff --git a/A.java b/A.java',
      'index 1..2 100644',
      '--- a/A.java',
      '+++ b/A.java',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '-- ',
      '2.34.1',
    ].join('\n');
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'A.java', additions: 1, deletions: 1 });
  });
});

describe('parseHunks (GitHub patch alanı)', () => {
  it('başlıksız hunk dizisini ayrıştırır', () => {
    const patch = '@@ -1,2 +1,3 @@ public class A {\n a\n+b\n c\n@@ -20 +21 @@\n-x\n+y\n\\ No newline at end of file';
    const hunks = parseHunks(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, header: 'public class A {' });
    expect(hunks[1]).toMatchObject({ oldStart: 20, oldLines: 1, newStart: 21, newLines: 1 });
    expect(hunks[1]?.lines).toEqual([
      { type: 'del', oldNo: 20, text: 'x' },
      { type: 'add', newNo: 21, text: 'y' },
    ]);
  });
  it('boş patch → []', () => {
    expect(parseHunks('')).toEqual([]);
  });
});

describe('hunksForAddedContent', () => {
  it('içerikten ekleme hunk\'ı üretir', () => {
    const r = hunksForAddedContent('a\r\nb\n');
    expect(r.additions).toBe(2);
    expect(r.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 });
    expect(r.hunks[0]?.lines).toEqual([
      { type: 'add', newNo: 1, text: 'a' },
      { type: 'add', newNo: 2, text: 'b' },
    ]);
    expect(hunksForAddedContent('').hunks).toEqual([]);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManagedChangeSet } from './common.js';
import { SourceError } from './errors.js';
import {
  createGitChangeSet,
  createWorktreeChangeSet,
  getGitRefs,
  GitBlobReader,
  resolveRepoRoot,
  runGit,
} from './git.js';

// Yığın: sonra eklenen önce çalışır (süreçler dizin silinmeden kapanır).
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reviewist-git-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function write(repo: string, rel: string, content: string | Buffer): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function commitAll(repo: string, msg: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', msg);
  return git(repo, 'rev-parse', 'HEAD').trim();
}

function track(cs: ManagedChangeSet): ManagedChangeSet {
  cleanups.push(() => cs.dispose()); // dizin silinmeden önce süreç kapanmalı
  return cs;
}

const javaClass = (pkg: string, name: string, body = ''): string =>
  `package ${pkg};\n\npublic class ${name} {\n${body}  public int value() {\n    return 1;\n  }\n}\n`;

describe('runGit / resolveRepoRoot hataları', () => {
  it('klasör yoksa PATH_NOT_FOUND', async () => {
    await expect(resolveRepoRoot(join(tmpdir(), 'reviewist-yok-xyz-123'))).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
  });
  it('git deposu değilse NOT_A_REPO (Türkçe)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reviewist-norepo-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const err = await resolveRepoRoot(dir).catch((e: unknown) => e);
    // Not: tmpdir bir üst depo içindeyse bu test anlamsızdır; normalde değildir.
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).code).toBe('NOT_A_REPO');
    expect((err as SourceError).message).toContain('git deposu değil');
  });
  it('büyük çıktıyı bütün olarak döndürür', async () => {
    const repo = makeRepo();
    write(repo, 'a.txt', 'x');
    commitAll(repo, 'c');
    const out = await runGit(repo, ['log', '--format=%H']);
    expect(out.trim()).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('createGitChangeSet', () => {
  it('değişiklik, rename, silme, ikili ve Türkçe karakterli dosya', async () => {
    const repo = makeRepo();
    write(repo, 'src/com/acme/A.java', javaClass('com.acme', 'A'));
    write(repo, 'src/com/acme/Old.java', javaClass('com.acme', 'Old', '  // uzun bir gövde satırı ki rename benzerliği yüksek kalsın\n'.repeat(5)));
    write(repo, 'src/com/acme/Gone.java', 'package com.acme;\n\nenum Gone { A, B, C, D, E, F, G, H }\n');
    write(repo, 'README.md', '# x\n');
    const c1 = commitAll(repo, 'ilk');
    git(repo, 'checkout', '-q', '-b', 'feature/x');
    write(repo, 'src/com/acme/A.java', javaClass('com.acme', 'A', '  private int count;\n'));
    git(repo, 'mv', 'src/com/acme/Old.java', 'src/com/acme/Renamed.java');
    rmSync(join(repo, 'src/com/acme/Gone.java'));
    write(repo, 'assets/logo.bin', Buffer.from([0, 1, 2, 3, 0, 255, 0]));
    write(repo, 'src/com/acme/Çalışan.java', javaClass('com.acme', 'Çalışan'));
    const c2 = commitAll(repo, 'değişiklik');

    const cs = track(await createGitChangeSet({ repoPath: repo, base: 'main', head: 'feature/x' }));
    expect(cs.info).toMatchObject({ kind: 'git', title: 'main...feature/x', baseRef: 'main', headRef: 'feature/x', baseSha: c1, headSha: c2 });
    const byPath = new Map(cs.files.map((f) => [f.path, f]));
    expect(byPath.get('src/com/acme/A.java')).toMatchObject({ status: 'modified', additions: 1, deletions: 0 });
    expect(byPath.get('src/com/acme/Renamed.java')).toMatchObject({ status: 'renamed', oldPath: 'src/com/acme/Old.java' });
    expect(byPath.get('src/com/acme/Gone.java')).toMatchObject({ status: 'deleted' });
    expect(byPath.get('assets/logo.bin')).toMatchObject({ status: 'added', binary: true });
    expect(byPath.get('src/com/acme/Çalışan.java')).toMatchObject({ status: 'added', binary: false, additions: 7 });

    expect(await cs.readFile('new', 'src/com/acme/A.java')).toContain('private int count;');
    expect(await cs.readFile('old', 'src/com/acme/A.java')).not.toContain('private int count;');
    // rename: old tarafı yeni yolla da eski yolla da okunabilir
    expect(await cs.readFile('old', 'src/com/acme/Renamed.java')).toContain('class Old');
    expect(await cs.readFile('old', 'src/com/acme/Old.java')).toContain('class Old');
    expect(await cs.readFile('new', 'src/com/acme/Old.java')).toBeUndefined();
    expect(await cs.readFile('new', 'src/com/acme/Gone.java')).toBeUndefined();
    expect(await cs.readFile('old', 'src/com/acme/Gone.java')).toContain('enum Gone');
    expect(await cs.readFile('old', 'src/com/acme/Çalışan.java')).toBeUndefined();
    expect(await cs.readFile('new', 'src/com/acme/Çalışan.java')).toContain('class Çalışan');
    expect(await cs.readFile('new', 'assets/logo.bin')).toBeUndefined();
    expect(await cs.readFile('new', 'README.md')).toBe('# x\n'); // değişmeyen dosya
    expect(await cs.readFile('new', 'yok/Böyle.java')).toBeUndefined();

    const java = await cs.listFiles('new', '.java');
    expect(java.sort()).toEqual(['src/com/acme/A.java', 'src/com/acme/Renamed.java', 'src/com/acme/Çalışan.java'].sort());
    expect(await cs.listFiles('new')).toContain('README.md');
  });

  it('mergeBase (PR semantiği) ve range farkı', async () => {
    const repo = makeRepo();
    write(repo, 'A.java', 'class A {}\n');
    write(repo, 'B.java', 'class B {}\n');
    const c1 = commitAll(repo, 'c1');
    git(repo, 'checkout', '-q', '-b', 'feature');
    write(repo, 'A.java', 'class A { int x; }\n');
    commitAll(repo, 'feature: A');
    git(repo, 'checkout', '-q', 'main');
    write(repo, 'B.java', 'class B { int y; }\n');
    commitAll(repo, 'main: B');

    const mb = track(await createGitChangeSet({ repoPath: repo, base: 'main', head: 'feature' }));
    expect(mb.info.baseSha).toBe(c1);
    expect(mb.files.map((f) => f.path)).toEqual(['A.java']);

    const range = track(await createGitChangeSet({ repoPath: repo, base: 'main', head: 'feature', mode: 'range' }));
    expect(range.files.map((f) => f.path).sort()).toEqual(['A.java', 'B.java']);
  });

  it('bulunamayan ref ve tehlikeli ref Türkçe hata verir', async () => {
    const repo = makeRepo();
    write(repo, 'A.java', 'class A {}\n');
    commitAll(repo, 'c1');
    await expect(createGitChangeSet({ repoPath: repo, base: 'main', head: 'yok-dal' })).rejects.toMatchObject({
      code: 'REF_NOT_FOUND',
      status: 400,
    });
    await expect(createGitChangeSet({ repoPath: repo, base: '--output=x', head: 'main' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('dispose sonrası okuma undefined döner', async () => {
    const repo = makeRepo();
    write(repo, 'A.java', 'class A {}\n');
    commitAll(repo, 'c1');
    write(repo, 'A.java', 'class A { }\n');
    commitAll(repo, 'c2');
    const cs = await createGitChangeSet({ repoPath: repo, base: 'HEAD~1', head: 'HEAD', mode: 'range' });
    expect(await cs.readFile('new', 'A.java')).toBe('class A { }\n');
    await cs.dispose();
    await cs.dispose(); // idempotent
    expect(await cs.readFile('new', 'A.java')).toBeUndefined();
  });
});

describe('createWorktreeChangeSet', () => {
  it('staged + unstaged + izlenmeyen dosyalar; yoksayılan dosyalar okunmaz', async () => {
    const repo = makeRepo();
    write(repo, '.gitignore', 'secret.txt\n');
    write(repo, 'src/A.java', 'class A {}\n');
    write(repo, 'src/B.java', 'class B {}\n');
    write(repo, 'src/C.java', 'class C {}\n');
    commitAll(repo, 'c1');
    write(repo, 'src/A.java', 'class A { int unstaged; }\n'); // unstaged
    write(repo, 'src/B.java', 'class B { int staged; }\n');
    git(repo, 'add', 'src/B.java'); // staged
    rmSync(join(repo, 'src/C.java')); // silinmiş (unstaged)
    write(repo, 'src/Yeni Sınıf.java', 'class YeniSinif {\n  int a;\n}\n'); // izlenmeyen
    write(repo, 'secret.txt', 'TOKEN=gizli\n'); // yoksayılan

    const cs = track(await createWorktreeChangeSet({ repoPath: repo }));
    expect(cs.info).toMatchObject({ kind: 'git', headRef: 'WORKTREE', baseRef: 'HEAD' });
    const byPath = new Map(cs.files.map((f) => [f.path, f]));
    expect(byPath.get('src/A.java')?.status).toBe('modified');
    expect(byPath.get('src/B.java')?.status).toBe('modified');
    expect(byPath.get('src/C.java')?.status).toBe('deleted');
    const untracked = byPath.get('src/Yeni Sınıf.java');
    expect(untracked).toMatchObject({ status: 'added', additions: 3, deletions: 0 });
    expect(untracked?.hunks[0]?.lines[2]).toEqual({ type: 'add', newNo: 3, text: '}' });
    expect(byPath.has('secret.txt')).toBe(false);

    expect(await cs.readFile('new', 'src/A.java')).toBe('class A { int unstaged; }\n');
    expect(await cs.readFile('old', 'src/A.java')).toBe('class A {}\n');
    expect(await cs.readFile('new', 'src/Yeni Sınıf.java')).toContain('YeniSinif');
    expect(await cs.readFile('old', 'src/Yeni Sınıf.java')).toBeUndefined();
    expect(await cs.readFile('new', 'src/C.java')).toBeUndefined();
    expect(await cs.readFile('new', 'secret.txt')).toBeUndefined();
    expect(await cs.readFile('new', '../../etc/passwd')).toBeUndefined();

    const java = await cs.listFiles('new', '.java');
    expect(java.sort()).toEqual(['src/A.java', 'src/B.java', 'src/Yeni Sınıf.java']);
  });

  it('includeUntracked=false izlenmeyenleri dışarıda bırakır', async () => {
    const repo = makeRepo();
    write(repo, 'A.java', 'class A {}\n');
    commitAll(repo, 'c1');
    write(repo, 'B.java', 'class B {}\n');
    const cs = track(await createWorktreeChangeSet({ repoPath: repo, includeUntracked: false }));
    expect(cs.files).toEqual([]);
  });
});

describe('getGitRefs', () => {
  it('dallar, etiketler, son commitler, varsayılan taban', async () => {
    const repo = makeRepo();
    write(repo, 'A.java', 'class A {}\n');
    commitAll(repo, 'ilk commit');
    git(repo, 'tag', 'v1.0');
    git(repo, 'checkout', '-q', '-b', 'feature/ç');
    write(repo, 'A.java', 'class A { }\n');
    commitAll(repo, 'ikinci');
    const refs = await getGitRefs(repo);
    expect(refs.branches).toEqual(['feature/ç', 'main']);
    expect(refs.currentBranch).toBe('feature/ç');
    expect(refs.defaultBase).toBe('main');
    expect(refs.tags).toEqual(['v1.0']);
    expect(refs.remoteBranches).toEqual([]);
    expect(refs.recentCommits).toHaveLength(2);
    expect(refs.recentCommits[0]).toMatchObject({ subject: 'ikinci', author: 'Test' });
    expect(refs.recentCommits[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(refs.recentCommits[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('GitBlobReader', () => {
  it('3000 dosyayı tek süreçle birkaç saniyede okur; missing ve büyük blob doğru', async () => {
    const repo = makeRepo();
    const N = 3000;
    for (let i = 0; i < N; i++) {
      write(repo, `src/p${i % 30}/C${i}.java`, javaClass(`p${i % 30}`, `C${i}`, `  // dosya ${i}\n`));
    }
    const big = 'x'.repeat(3 * 1024 * 1024) + '\nson\n';
    write(repo, 'big.txt', big);
    const head = commitAll(repo, 'çok dosya');
    const reader = new GitBlobReader(repo);
    cleanups.push(() => reader.close());

    const t0 = performance.now();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => reader.readText(head, `src/p${i % 30}/C${i}.java`)),
    );
    const ms = performance.now() - t0;
    console.log(`GitBlobReader: ${N} dosya ${ms.toFixed(0)} ms`);
    expect(results.every((r, i) => r?.includes(`class C${i} `) && r.includes(`// dosya ${i}\n`))).toBe(true);
    expect(ms).toBeLessThan(5000);

    expect(await reader.readText(head, 'yok.java')).toBeUndefined();
    expect(await reader.readText(head, 'src')).toBeUndefined(); // ağaç, blob değil
    const bigRead = await reader.readText(head, 'big.txt');
    expect(bigRead?.length).toBe(big.length);
    expect(bigRead?.endsWith('\nson\n')).toBe(true);
    // önbellekten ikinci okuma
    const t1 = performance.now();
    await reader.readText(head, 'src/p0/C0.java');
    expect(performance.now() - t1).toBeLessThan(50);

    await reader.close();
    await expect(reader.read(head, 'big.txt')).rejects.toThrow('kapatıldı');
  });
});

describe('stableKey, diff dışı dosyalar, hata alanları, ilerleme', () => {
  it('git: stableKey ref adlarıyla sabit; diff dışı dosya iki ağaçtan okunur; ilerleme bildirilir', async () => {
    const repo = makeRepo();
    write(repo, 'src/A.java', 'class A {}\n');
    write(repo, 'src/Sabit.java', 'class Sabit { int v1; }\n');
    commitAll(repo, 'c1');
    git(repo, 'checkout', '-q', '-b', 'feature/x');
    write(repo, 'src/A.java', 'class A { int x; }\n');
    commitAll(repo, 'c2');
    git(repo, 'checkout', '-q', 'main');
    write(repo, 'src/Sabit.java', 'class Sabit { int v2; }\n'); // yalnız main'de değişti (merge-base sonrası)
    commitAll(repo, 'c3');

    const progress: string[] = [];
    const cs = track(
      await createGitChangeSet({ repoPath: repo, base: 'main', head: 'feature/x', onProgress: (m) => progress.push(m) }),
    );
    expect(cs.files.map((f) => f.path)).toEqual(['src/A.java']);
    expect(progress).toContain('git diff alınıyor');
    expect(progress).toContain('git diff ayrıştırıldı: 1 dosya');
    const keyRepo = (process.platform === 'win32' ? repo.toLowerCase() : repo).replace(/\\/g, '/');
    expect(cs.info.stableKey).toBe(`git:${keyRepo}:main...feature/x:mergeBase`);
    const range = track(await createGitChangeSet({ repoPath: join(repo, 'src'), base: 'main', head: 'feature/x', mode: 'range' }));
    expect(range.info.stableKey).toBe(`git:${keyRepo}:main...feature/x:range`);

    // Diff dışı: new = head ağacı, old = merge-base ağacı
    expect(await cs.readFile('new', 'src/Sabit.java')).toBe('class Sabit { int v1; }\n');
    expect(await cs.readFile('old', 'src/Sabit.java')).toBe('class Sabit { int v1; }\n');
    expect(await range.readFile('old', 'src/Sabit.java')).toBe('class Sabit { int v2; }\n');
    // Yol güvenliği
    expect(await cs.readFile('new', '../x')).toBeUndefined();
    expect(await cs.readFile('new', '/src/A.java')).toBeUndefined();
    expect(await cs.readFile('new', 'C:\\x')).toBeUndefined();
    expect(await cs.readFile('new', 'src\\A.java')).toBe('class A { int x; }\n');
  });

  it('worktree: stableKey; diff dışı yeni taraf yalnız ls-files kümesinden', async () => {
    const repo = makeRepo();
    write(repo, 'src/A.java', 'class A {}\n');
    write(repo, 'src/Sabit.java', 'class Sabit {}\n');
    write(repo, '.gitignore', '.env\n');
    commitAll(repo, 'c1');
    write(repo, '.env', 'SECRET=1\n');
    write(repo, 'src/A.java', 'class A { int x; }\n');
    const progress: string[] = [];
    const cs = track(await createWorktreeChangeSet({ repoPath: repo, onProgress: (m) => progress.push(m) }));
    const keyRepo = (process.platform === 'win32' ? repo.toLowerCase() : repo).replace(/\\/g, '/');
    expect(cs.info.stableKey).toBe(`worktree:${keyRepo}:HEAD`);
    expect(progress[0]).toContain("Çalışma ağacı diff'i alınıyor");
    expect(await cs.readFile('new', 'src/Sabit.java')).toBe('class Sabit {}\n');
    expect(await cs.readFile('old', 'src/Sabit.java')).toBe('class Sabit {}\n');
    expect(await cs.readFile('new', '.env')).toBeUndefined();
    expect(await cs.readFile('new', 'src/../.env')).toBeUndefined();
  });

  it('kaynak hatalarında field: repoPath / base / head', async () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'reviewist-norepo-'));
    cleanups.push(() => rmSync(notRepo, { recursive: true, force: true }));
    await expect(createGitChangeSet({ repoPath: notRepo, base: 'a', head: 'b' })).rejects.toMatchObject({
      code: 'NOT_A_REPO',
      field: 'repoPath',
    });
    await expect(createGitChangeSet({ repoPath: join(notRepo, 'yok'), base: 'a', head: 'b' })).rejects.toMatchObject({
      code: 'PATH_NOT_FOUND',
      field: 'repoPath',
    });
    const repo = makeRepo();
    write(repo, 'A.java', 'class A {}\n');
    commitAll(repo, 'c1');
    await expect(createGitChangeSet({ repoPath: repo, base: 'yok', head: 'main' })).rejects.toMatchObject({ field: 'base' });
    await expect(createGitChangeSet({ repoPath: repo, base: 'main', head: '-x' })).rejects.toMatchObject({
      code: 'VALIDATION',
      field: 'head',
    });
    await expect(createWorktreeChangeSet({ repoPath: repo, base: 'yok' })).rejects.toMatchObject({ field: 'base' });
  });
});

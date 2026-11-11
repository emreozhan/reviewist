/**
 * `disableGitNetwork()` süreç genelinde kalıcıdır; bu yüzden ayrı bir test dosyasındadır (vitest her dosyayı
 * kendi modül örneğiyle çalıştırır, diğer testler etkilenmez).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGitChangeSet, disableGitNetwork, getGitRefs, runGitResult } from './git.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let dir: string;
let repo: string;
let remote: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'reviewist-nonet-'));
  repo = join(dir, 'repo');
  remote = join(dir, 'remote.git');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'user.email', 't@example.com');
  writeFileSync(join(repo, 'A.java'), 'class A {}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'c1');
  git(repo, 'checkout', '-q', '-b', 'feature');
  writeFileSync(join(repo, 'A.java'), 'class A { int x; }\n');
  git(repo, 'commit', '-q', '-am', 'c2');
  git(dir, 'clone', '-q', '--bare', repo, remote);
  git(repo, 'remote', 'add', 'origin', remote);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

describe('disableGitNetwork', () => {
  it('kapatılmadan önce uzak depoya erişilebilir; kapatılınca tüm taşıyıcılar reddedilir, yerel komutlar çalışır', async () => {
    const before = await runGitResult(repo, ['ls-remote', 'origin']);
    expect(before.code).toBe(0);
    expect(before.stdout).toContain('refs/heads/main');

    disableGitNetwork();

    // Yerel dosya taşıyıcısı dahil hiçbir uzak depoya gidilemez (fetch, ls-remote, clone).
    for (const args of [
      ['ls-remote', 'origin'],
      ['fetch', 'origin'],
      ['ls-remote', 'https://example.invalid/a/b.git'],
    ]) {
      const res = await runGitResult(repo, args);
      expect(res.code, args.join(' ')).not.toBe(0);
      expect(res.stderr, args.join(' ')).toMatch(/transport '\w+' not allowed/);
    }

    // Yerel analiz etkilenmez.
    const refs = await getGitRefs(repo);
    expect(refs.branches).toEqual(['feature', 'main']);
    const cs = await createGitChangeSet({ repoPath: repo, base: 'main', head: 'feature' });
    try {
      expect(cs.files.map((f) => f.path)).toEqual(['A.java']);
      expect(await cs.readFile('new', 'A.java')).toContain('int x');
    } finally {
      await cs.dispose();
    }
  });
});

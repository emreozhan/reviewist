import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetGitBinaryCache, resolveGitBinary } from './gitBinary.js';
import { getGitRefs, runGit } from './git.js';

const savedPath = process.env.PATH;
const savedGit = process.env.REVIEWIST_GIT;

afterEach(() => {
  process.env.PATH = savedPath;
  if (savedGit === undefined) delete process.env.REVIEWIST_GIT;
  else process.env.REVIEWIST_GIT = savedGit;
  resetGitBinaryCache();
});

describe('resolveGitBinary', () => {
  it('PATH içinde git varsa düz `git` kullanılır', () => {
    resetGitBinaryCache();
    expect(resolveGitBinary()).toMatchObject({ command: 'git', source: 'path' });
  });

  it('PATH git içermiyorsa bilinen kurulum yerinden bulunur ve git komutları çalışır', async () => {
    const real = resolveGitBinary().command;
    const repo = mkdtempSync(join(tmpdir(), 'reviewist-gitbin-'));
    try {
      await runGit(repo, ['init', '-q', '-b', 'main']);
      // Electron'dan başlatılmış gibi: PATH yalnız Windows sistem klasörü (git yok).
      process.env.PATH = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/nonexistent';
      resetGitBinaryCache();
      const info = resolveGitBinary();
      if (real === 'git' && info.source === 'none') {
        // Bu makinede git yalnız PATH'te, bilinen bir yerde değil: çözücü bulamaz; test anlamsız.
        return;
      }
      expect(info.source).not.toBe('path');
      expect(info.command).not.toBe('git');
      const refs = await getGitRefs(repo);
      expect(refs.repoPath.length).toBeGreaterThan(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('REVIEWIST_GIT verilirse önceliklidir', () => {
    resetGitBinaryCache();
    const found = resolveGitBinary().command;
    process.env.REVIEWIST_GIT = found;
    resetGitBinaryCache();
    expect(resolveGitBinary()).toMatchObject({ command: found, source: 'env' });
  });

  it('hiçbir yerde yoksa source none ve denenen adaylar listelenir', () => {
    process.env.REVIEWIST_GIT = join(tmpdir(), 'yok', 'git.exe');
    process.env.PATH = '/nonexistent';
    resetGitBinaryCache();
    const info = resolveGitBinary();
    if (info.source === 'none') {
      expect(info.tried.length).toBeGreaterThan(1);
    } else {
      // Bu makinede git bilinen bir yerde kurulu: env adayı atlanıp oradan bulunmalı.
      expect(info.source === 'registry' || info.source === 'known').toBe(true);
    }
  });
});

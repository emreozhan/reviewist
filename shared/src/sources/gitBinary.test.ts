import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetGitBinaryCache, resolveGitBinary } from './gitBinary.js';
import { getGitRefs, runGit } from './git.js';

const savedPath = process.env.PATH;
const savedGit = process.env.REVIEWIST_GIT;
const savedCwd = process.cwd();

afterEach(() => {
  process.chdir(savedCwd);
  process.env.PATH = savedPath;
  if (savedGit === undefined) delete process.env.REVIEWIST_GIT;
  else process.env.REVIEWIST_GIT = savedGit;
  resetGitBinaryCache();
});

describe('resolveGitBinary', () => {
  it("PATH'teki git mutlak yoluyla çözülür (çıplak `git` asla çalıştırılmaz)", () => {
    resetGitBinaryCache();
    const info = resolveGitBinary();
    expect(info.source).toBe('path');
    expect(isAbsolute(info.command)).toBe(true);
  });

  it('göreli PATH girdileri ve çalışma dizinindeki sahte git yok sayılır', () => {
    const real = resolveGitBinary().command;
    const evil = realpathSync(mkdtempSync(join(tmpdir(), 'reviewist-evilcwd-')));
    try {
      // İncelenen depoya konmuş sahte bir "git": çalışma dizininde durur, PATH'te yalnız göreli girdiyle erişilebilir.
      writeFileSync(join(evil, process.platform === 'win32' ? 'git.exe' : 'git'), 'sahte', { mode: 0o755 });
      process.chdir(evil);
      process.env.PATH = ['.', '', dirname(real)].join(delimiter);
      resetGitBinaryCache();
      const info = resolveGitBinary();
      expect(isAbsolute(info.command)).toBe(true);
      expect(info.command.toLowerCase().startsWith(evil.toLowerCase())).toBe(false);
      expect(info.source).toBe('path');
    } finally {
      process.chdir(savedCwd);
      rmSync(evil, { recursive: true, force: true });
    }
  });

  it('PATH git içermiyorsa bilinen kurulum yerinden bulunur ve git komutları çalışır', async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'reviewist-gitbin-')));
    try {
      await runGit(repo, ['init', '-q', '-b', 'main']);
      // Bir masaüstü başlatıcısından açılmış gibi: PATH'te git yok.
      process.env.PATH = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/nonexistent';
      resetGitBinaryCache();
      const info = resolveGitBinary();
      // Bu makinede git yalnız PATH'te, bilinen bir yerde değilse çözücü bulamaz; o durumda sınanacak bir şey yok.
      if (info.source === 'none') return;
      expect(info.source).not.toBe('path');
      expect(isAbsolute(info.command)).toBe(true);
      const refs = await getGitRefs(repo);
      expect(refs.repoPath.length).toBeGreaterThan(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('REVIEWIST_GIT mutlak yol ise önceliklidir; göreli ise yok sayılır', () => {
    resetGitBinaryCache();
    const found = resolveGitBinary().command;
    process.env.REVIEWIST_GIT = found;
    resetGitBinaryCache();
    expect(resolveGitBinary()).toMatchObject({ command: found, source: 'env' });

    process.env.REVIEWIST_GIT = 'git';
    resetGitBinaryCache();
    const info = resolveGitBinary();
    expect(info.source).not.toBe('env');
    expect(info.tried.some((t) => t.includes('mutlak yol olmalı'))).toBe(true);
  });

  it('hiçbir yerde yoksa source none döner, denenenler listelenir ve git çalıştırılmaz', async () => {
    process.env.REVIEWIST_GIT = join(tmpdir(), 'yok', 'git.exe');
    process.env.PATH = process.platform === 'win32' ? 'C:\\yok-klasor' : '/nonexistent';
    resetGitBinaryCache();
    const info = resolveGitBinary();
    if (info.source !== 'none') {
      // Bu makinede git bilinen bir yerde kurulu: env adayı atlanıp oradan bulunmalı.
      expect(info.source === 'registry' || info.source === 'known').toBe(true);
      return;
    }
    expect(info.tried.length).toBeGreaterThan(1);
    await expect(runGit(tmpdir(), ['--version'])).rejects.toThrow(/Git bulunamadı/);
  });
});

import { describe, expect, it } from 'vitest';
import { CliUsageError, HELP_TEXT, parseCliArgs } from './cliOptions.js';

describe('parseCliArgs (reviewist-local)', () => {
  it('varsayılanlar', () => {
    expect(parseCliArgs([])).toEqual({
      repoPath: undefined,
      base: undefined,
      head: undefined,
      worktree: false,
      port: 4317,
      host: '127.0.0.1',
      open: true,
      help: false,
    });
  });

  it('tüm seçenekler', () => {
    expect(parseCliArgs(['../repo', '--base', 'main', '--head', 'feature/x', '--port', '4399', '--no-open'])).toMatchObject({
      repoPath: '../repo',
      base: 'main',
      head: 'feature/x',
      port: 4399,
      open: false,
    });
    expect(parseCliArgs(['--worktree', '--base', 'HEAD~2'])).toMatchObject({ worktree: true, base: 'HEAD~2' });
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--host', '[::1]']).host).toBe('::1');
  });

  it('geçersiz kullanım Türkçe hata verir', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow(/--port 1-65535/);
    expect(() => parseCliArgs(['--host', '0.0.0.0'])).toThrow(/yalnızca yerel adrese/);
    expect(() => parseCliArgs(['--worktree', '--head', 'x'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--bilinmeyen'])).toThrow(/Geçersiz argüman/);
    expect(() => parseCliArgs(['a', 'b'])).toThrow(/bir depo yolu/);
  });

  it('uzak depo seçenekleri yerel uygulamada yoktur', () => {
    expect(() => parseCliArgs(['--pr', 'https://github.com/a/b/pull/1'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--token-env', 'X'])).toThrow(CliUsageError);
    expect(HELP_TEXT).not.toMatch(/--pr\b|token/i);
  });
});

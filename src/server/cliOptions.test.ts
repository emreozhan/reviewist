import { describe, expect, it } from 'vitest';
import { CliUsageError, parseCliArgs } from './cliOptions.js';

describe('parseCliArgs', () => {
  it('varsayılanlar', () => {
    expect(parseCliArgs([])).toEqual({
      repoPath: undefined,
      base: undefined,
      head: undefined,
      worktree: false,
      pr: undefined,
      tokenEnv: undefined,
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
    expect(parseCliArgs(['--pr', 'https://github.com/a/b/pull/1', '--token-env', 'IS_TOKEN'])).toMatchObject({
      pr: 'https://github.com/a/b/pull/1',
      tokenEnv: 'IS_TOKEN',
    });
    expect(parseCliArgs(['--worktree', '--base', 'HEAD~2'])).toMatchObject({ worktree: true, base: 'HEAD~2' });
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--host', '[::1]']).host).toBe('::1');
  });

  it('geçersiz kullanım Türkçe hata verir', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow(/--port 1-65535/);
    expect(() => parseCliArgs(['--host', '0.0.0.0'])).toThrow(/yalnızca yerel adrese/);
    expect(() => parseCliArgs(['--pr', 'x', '--worktree'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--pr', 'x', '--base', 'main'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--worktree', '--head', 'x'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--bilinmeyen'])).toThrow(/Geçersiz argüman/);
    expect(() => parseCliArgs(['a', 'b'])).toThrow(/bir depo yolu/);
    expect(() => parseCliArgs(['--token-env', 'A-B'])).toThrow(/ortam değişkeni adı/);
  });
});

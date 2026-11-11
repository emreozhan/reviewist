import { describe, expect, it } from 'vitest';
import { CliUsageError, DEFAULT_PORT, HELP_TEXT, parseGithubCliArgs } from './cliOptions.js';

describe('parseGithubCliArgs', () => {
  it('varsayılanlar', () => {
    expect(parseGithubCliArgs([])).toEqual({ port: DEFAULT_PORT, host: '127.0.0.1', open: true, help: false });
    expect(DEFAULT_PORT).toBe(4318);
  });

  it('adres ve tüm seçenekler', () => {
    expect(
      parseGithubCliArgs([
        'https://github.com/acme/shop',
        '--base',
        'main',
        '--head',
        'feature/x',
        '--token-env',
        'IS_TOKEN',
        '--token-env',
        'GH_TOKEN',
        '--cache-dir',
        '/tmp/onbellek',
        '--port',
        '4400',
        '--host',
        'localhost',
        '--no-open',
      ]),
    ).toEqual({
      url: 'https://github.com/acme/shop',
      base: 'main',
      head: 'feature/x',
      tokenEnvNames: ['IS_TOKEN', 'GH_TOKEN'],
      cacheDir: '/tmp/onbellek',
      port: 4400,
      host: 'localhost',
      open: false,
      help: false,
    });
    expect(parseGithubCliArgs(['-h']).help).toBe(true);
    expect(parseGithubCliArgs(['acme/shop#3', '--host', '[::1]'])).toMatchObject({ url: 'acme/shop#3', host: '::1' });
  });

  it('hatalı kullanım: Türkçe CliUsageError', () => {
    const bad: [string[], RegExp][] = [
      [['a/b', 'c/d'], /Yalnızca bir adres/],
      [['--base', 'main'], /yalnız bir adresle/],
      [['a/b', '--port', '0'], /--port/],
      [['a/b', '--host', '0.0.0.0'], /yerel adrese/],
      [['a/b', '--token-env', 'A-B'], /ortam değişkeni adı/],
      [['a/b', '--cache-dir', ' '], /boş olamaz/],
      [['--bilinmeyen'], /Geçersiz argüman/],
    ];
    for (const [argv, re] of bad) {
      expect(() => parseGithubCliArgs(argv), argv.join(' ')).toThrow(CliUsageError);
      expect(() => parseGithubCliArgs(argv), argv.join(' ')).toThrow(re);
    }
  });

  it('yardım metni Türkçe ve örnekli', () => {
    expect(HELP_TEXT).toContain('Kullanım:');
    expect(HELP_TEXT).toContain('Örnekler:');
    expect(HELP_TEXT).toContain('--token-env');
  });
});

import { describe, expect, it } from 'vitest';
import { APP_NAME, DEFAULT_PORT, EDITION, editionInfo, editionMismatch, IS_GITHUB, IS_LOCAL, isEdition, START_COMMAND } from './edition';

describe('edition', () => {
  it('testler yerel sürümle koşar (vitest.config.ts define)', () => {
    expect(EDITION).toBe('local');
    expect(IS_LOCAL).toBe(true);
    expect(IS_GITHUB).toBe(false);
    expect(APP_NAME).toBe('Reviewist Yerel');
    expect(START_COMMAND).toBe('node bin/reviewist-local.js');
    expect(DEFAULT_PORT).toBe(4317);
  });

  it('iki sürümün sabitleri', () => {
    expect(editionInfo('local')).toEqual({ edition: 'local', appName: 'Reviewist Yerel', startCommand: 'node bin/reviewist-local.js', defaultPort: 4317 });
    expect(editionInfo('github')).toEqual({ edition: 'github', appName: 'Reviewist GitHub', startCommand: 'node bin/reviewist-github.js', defaultPort: 4318 });
  });

  it('isEdition', () => {
    expect(isEdition('local')).toBe(true);
    expect(isEdition('github')).toBe(true);
    expect(isEdition('GitHub')).toBe(false);
    expect(isEdition(undefined)).toBe(false);
  });

  it('sürüm uyuşmazlığı uyarısı', () => {
    expect(editionMismatch('local', undefined)).toBeUndefined();
    expect(editionMismatch('local', { edition: 'local' })).toBeUndefined();
    expect(editionMismatch('github', { edition: 'github' })).toBeUndefined();
    const m = editionMismatch('local', { edition: 'github' });
    expect(m).toContain('Bu arayüz Reviewist Yerel için derlendi ama sunucu Reviewist GitHub olarak çalışıyor');
    expect(m).toContain('4317');
    expect(m).toContain('4318');
    expect(editionMismatch('github', { edition: 'local' })).toContain('Bu arayüz Reviewist GitHub için derlendi ama sunucu Reviewist Yerel olarak çalışıyor');
  });

  it('sürüm bildirmeyen (eski) sunucu', () => {
    const old = JSON.parse('{"version":"0.1.0"}') as { edition: 'local' };
    expect(editionMismatch('github', old)).toContain('hangi uygulama olduğunu bildirmedi');
  });
});

import { describe, expect, it } from 'vitest';
import { isRecognizedTarget, looksLikePrUrl, validateGithubForm } from './githubTarget';

describe('looksLikePrUrl', () => {
  it('PR adresleri', () => {
    expect(looksLikePrUrl('https://github.com/sahip/depo/pull/123')).toBe(true);
    expect(looksLikePrUrl('https://github.com/sahip/depo/pull/123/files')).toBe(true);
    expect(looksLikePrUrl('https://ghe.example.com/takim/depo/pull/7?w=1')).toBe(true);
    expect(looksLikePrUrl('  sahip/depo#123 ')).toBe(true);
  });

  it('depo adresleri PR sayılmaz', () => {
    expect(looksLikePrUrl('https://github.com/sahip/depo')).toBe(false);
    expect(looksLikePrUrl('https://github.com/sahip/depo.git')).toBe(false);
    expect(looksLikePrUrl('git@github.com:sahip/depo.git')).toBe(false);
    expect(looksLikePrUrl('sahip/depo')).toBe(false);
    expect(looksLikePrUrl('https://github.com/sahip/depo/pulls')).toBe(false);
    expect(looksLikePrUrl('https://github.com/sahip/depo/pull/12abc')).toBe(false);
    expect(looksLikePrUrl('')).toBe(false);
  });
});

describe('isRecognizedTarget', () => {
  it('tanınan biçimler', () => {
    for (const u of ['https://github.com/sahip/depo/pull/1', 'sahip/depo#1', 'sahip/depo', 'https://github.com/sahip/depo', 'git@github.com:sahip/depo.git', 'ssh://git@github.com/sahip/depo.git']) {
      expect(isRecognizedTarget(u), u).toBe(true);
    }
  });

  it('tanınmayanlar', () => {
    for (const u of ['depo', 'https://github.com/sahip', 'ftp//x', 'sahip / depo', 'C:\\work\\shop']) {
      expect(isRecognizedTarget(u), u).toBe(false);
    }
  });
});

describe('validateGithubForm', () => {
  it('PR adresinde taban ve head isteğe bağlı; boş alanlar istekte yer almaz', () => {
    const r = validateGithubForm({ url: ' https://github.com/sahip/depo/pull/123 ', base: ' ', head: '' });
    expect(r.errors).toEqual({});
    expect(r.request).toEqual({ kind: 'github', url: 'https://github.com/sahip/depo/pull/123' });
  });

  it('PR adresinde verilen taban/head istekte gider', () => {
    const r = validateGithubForm({ url: 'sahip/depo#5', base: 'develop', head: 'feature/x' });
    expect(r.request).toEqual({ kind: 'github', url: 'sahip/depo#5', base: 'develop', head: 'feature/x' });
  });

  it('depo adresinde head zorunlu', () => {
    const r = validateGithubForm({ url: 'https://github.com/sahip/depo', base: '', head: '' });
    expect(r.request).toBeUndefined();
    expect(r.errors.head).toMatch(/^zorunlu/);
    expect(r.errors.url).toBeUndefined();
  });

  it('depo adresi + head geçerli; taban boşsa varsayılan dal sunucuya bırakılır', () => {
    const r = validateGithubForm({ url: 'git@github.com:sahip/depo.git', base: '', head: 'v1.4.0' });
    expect(r.request).toEqual({ kind: 'github', url: 'git@github.com:sahip/depo.git', head: 'v1.4.0' });
  });

  it('boş ve tanınmayan adres', () => {
    expect(validateGithubForm({ url: '', base: '', head: '' }).errors).toEqual({ url: expect.stringMatching(/^zorunlu/) });
    expect(validateGithubForm({ url: 'depo', base: '', head: 'x' }).errors.url).toMatch(/biçim tanınmadı/);
  });

  it('taban ile head aynı olamaz; boşluk içeremez', () => {
    expect(validateGithubForm({ url: 'sahip/depo', base: 'main', head: 'main' }).errors.head).toBe('taban ile aynı olamaz.');
    expect(validateGithubForm({ url: 'sahip/depo#1', base: 'ma in', head: '' }).errors.base).toBe('boşluk içeremez.');
  });
});

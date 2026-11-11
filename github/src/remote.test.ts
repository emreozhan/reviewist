import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SourceError } from '../../shared/src/sources/errors.js';
import { parseRemoteSpec } from './remote.js';

const NO_ENV: NodeJS.ProcessEnv = {};

describe('parseRemoteSpec: PR adresleri', () => {
  it('github.com PR, ek yol ve sorgu', () => {
    expect(parseRemoteSpec('https://github.com/acme/shop/pull/7/files?diff=split', NO_ENV)).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'shop',
      prNumber: 7,
      cloneUrl: 'https://github.com/acme/shop.git',
      webUrl: 'https://github.com/acme/shop/pull/7',
      apiBase: 'https://api.github.com',
    });
  });

  it('www.github.com → github.com; kısa biçim; GHE', () => {
    expect(parseRemoteSpec('https://www.github.com/acme/shop/pull/7', NO_ENV)).toMatchObject({ host: 'github.com', prNumber: 7 });
    expect(parseRemoteSpec('acme/shop#3', NO_ENV)).toMatchObject({ host: 'github.com', owner: 'acme', repo: 'shop', prNumber: 3 });
    expect(parseRemoteSpec('https://git.sirket.com.tr/takim/servis/pull/12/commits', NO_ENV)).toMatchObject({
      host: 'git.sirket.com.tr',
      prNumber: 12,
      apiBase: 'https://git.sirket.com.tr/api/v3',
      cloneUrl: 'https://git.sirket.com.tr/takim/servis.git',
      webUrl: 'https://git.sirket.com.tr/takim/servis/pull/12',
    });
  });

  it('geçersiz PR numarası ve issue adresi reddedilir', () => {
    expect(() => parseRemoteSpec('https://github.com/acme/shop/issues/7', NO_ENV)).toThrow(SourceError);
    expect(() => parseRemoteSpec('https://github.com/acme/shop/pull/0', NO_ENV)).toThrow(/PR numarası/);
    expect(() => parseRemoteSpec('acme/shop#x', NO_ENV)).toThrow(SourceError);
  });
});

describe('parseRemoteSpec: depo adresleri', () => {
  it('https, .git soneki, sondaki /', () => {
    for (const u of ['https://github.com/acme/shop', 'https://github.com/acme/shop.git', 'https://github.com/acme/shop/']) {
      expect(parseRemoteSpec(u, NO_ENV)).toEqual({
        host: 'github.com',
        owner: 'acme',
        repo: 'shop',
        cloneUrl: 'https://github.com/acme/shop.git',
        webUrl: 'https://github.com/acme/shop',
        apiBase: 'https://api.github.com',
      });
    }
  });

  it('SSH (scp tarzı ve ssh://) adresi aynen klonlanır', () => {
    expect(parseRemoteSpec('git@github.com:Acme/Shop.git', NO_ENV)).toMatchObject({
      host: 'github.com',
      owner: 'Acme',
      repo: 'Shop',
      cloneUrl: 'git@github.com:Acme/Shop.git',
      webUrl: 'https://github.com/Acme/Shop',
    });
    expect(parseRemoteSpec('ssh://git@git.sirket.com:2222/takim/servis.git', NO_ENV)).toMatchObject({
      host: 'git.sirket.com',
      owner: 'takim',
      repo: 'servis',
      cloneUrl: 'ssh://git@git.sirket.com:2222/takim/servis.git',
      apiBase: 'https://git.sirket.com/api/v3',
    });
  });

  it('kısa sahip/depo', () => {
    expect(parseRemoteSpec('acme/shop', NO_ENV)).toMatchObject({ host: 'github.com', owner: 'acme', repo: 'shop', cloneUrl: 'https://github.com/acme/shop.git' });
    expect(parseRemoteSpec('acme/shop', NO_ENV).prNumber).toBeUndefined();
  });

  it('REVIEWIST_GIT_PROTOCOL=ssh: https adresleri git@ ile getirilir', () => {
    const env = { REVIEWIST_GIT_PROTOCOL: 'ssh' };
    expect(parseRemoteSpec('https://github.com/acme/shop', env).cloneUrl).toBe('git@github.com:acme/shop.git');
    expect(parseRemoteSpec('acme/shop#4', env).cloneUrl).toBe('git@github.com:acme/shop.git');
    expect(parseRemoteSpec('https://ghe.example:8443/a/b', env).cloneUrl).toBe('git@ghe.example:a/b.git');
  });
});

describe('parseRemoteSpec: reddedilenler', () => {
  it('http (şifresiz)', () => {
    expect(() => parseRemoteSpec('http://github.com/acme/shop/pull/7', NO_ENV)).toThrow(/https/);
    expect(() => parseRemoteSpec('http://github.com/acme/shop', NO_ENV)).toThrow(/https/);
  });

  it('kimlik bilgisi gömülü https adresi', () => {
    expect(() => parseRemoteSpec('https://github.com:x@evil.example/acme/shop/pull/7', NO_ENV)).toThrow(/gömülemez/);
    expect(() => parseRemoteSpec('https://user@github.com/acme/shop', NO_ENV)).toThrow(/gömülemez/);
    expect(() => parseRemoteSpec('https://u:p@github.com/acme/shop', NO_ENV)).toThrow(SourceError);
  });

  it('kötü adlar ve seçenek enjeksiyonu', () => {
    for (const bad of [
      'https://github.com/ac me/shop',
      'https://github.com/acme/../x',
      'https://github.com/acme/sh$op',
      '../shop',
      'acme/sh;op',
      '-oProxyCommand=calc:acme/shop',
      'git@-evil:acme/shop.git',
      'ftp://github.com/a/b',
      'ext::sh -c touch%20x',
      'C:depo/x',
      '',
      'https://github.com/acme',
      'https://github.com/acme/shop/tree/main',
    ]) {
      expect(() => parseRemoteSpec(bad, NO_ENV), bad).toThrow(SourceError);
    }
  });

  it('hata alanı url ve Türkçe ileti', () => {
    try {
      parseRemoteSpec('nonsense', NO_ENV);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ status: 400, field: 'url' });
      expect((err as Error).message).toContain('Kabul edilen biçimler');
    }
  });
});

describe('parseRemoteSpec: yerel test kancası', () => {
  const abs = resolve('/tmp/uzaklar/depo.git');
  const fileUrl = pathToFileURL(abs).href;

  it('kanca kapalıyken file:// ve mutlak yol reddedilir', () => {
    expect(() => parseRemoteSpec(fileUrl, NO_ENV)).toThrow(/Reviewist Yerel/);
    expect(() => parseRemoteSpec(abs, NO_ENV)).toThrow(/Reviewist Yerel/);
    expect(() => parseRemoteSpec('file:///etc/x', { REVIEWIST_ALLOW_FILE_REMOTE: '0' })).toThrow(SourceError);
  });

  it('kanca açıkken host local, sahip/depo yolun son iki parçası', () => {
    const env = { REVIEWIST_ALLOW_FILE_REMOTE: '1' };
    expect(parseRemoteSpec(abs, env)).toEqual({
      host: 'local',
      owner: 'uzaklar',
      repo: 'depo',
      cloneUrl: abs,
      webUrl: abs,
      apiBase: '',
    });
    expect(parseRemoteSpec(fileUrl, env)).toMatchObject({ host: 'local', owner: 'uzaklar', repo: 'depo', cloneUrl: fileUrl });
    expect(parseRemoteSpec(`${abs}#5`, env)).toMatchObject({ host: 'local', prNumber: 5, cloneUrl: abs });
  });
});

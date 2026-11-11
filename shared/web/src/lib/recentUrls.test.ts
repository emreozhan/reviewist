import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from './persistence';
import { isSafeToRemember, loadRecentUrls, MAX_RECENT_URLS, pushRecentUrl, RECENT_URLS_KEY, rememberUrl } from './recentUrls';

function memory(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('isSafeToRemember', () => {
  it('kimlik bilgisi içermeyen adresler saklanır', () => {
    for (const u of ['https://github.com/sahip/depo/pull/1', 'sahip/depo#2', 'git@github.com:sahip/depo.git', 'ssh://git@github.com/sahip/depo.git', 'https://github.com/sahip/depo?tab=readme']) {
      expect(isSafeToRemember(u), u).toBe(true);
    }
  });

  it('kullanıcı adı/parola ya da token taşıyan adresler saklanmaz', () => {
    for (const u of [
      'https://kisi:gizli@github.com/sahip/depo',
      'https://ghp_abc@github.com/sahip/depo',
      'http://kisi@ghe.local/sahip/depo',
      'ssh://git:gizli@github.com/sahip/depo.git',
      'https://github.com/sahip/depo?access_token=abc',
      '',
      'iki kelime',
    ]) {
      expect(isSafeToRemember(u), u).toBe(false);
    }
  });
});

describe('son adresler', () => {
  it('başa ekler, tekrar etmez (harf duyarsız), en çok 8', () => {
    let list: string[] = [];
    for (let i = 0; i < 12; i++) list = pushRecentUrl(list, `sahip/depo${i}`);
    expect(list).toHaveLength(MAX_RECENT_URLS);
    expect(list[0]).toBe('sahip/depo11');
    list = pushRecentUrl(list, 'SAHIP/depo5');
    expect(list[0]).toBe('SAHIP/depo5');
    expect(list.filter((x) => x.toLowerCase() === 'sahip/depo5')).toHaveLength(1);
  });

  it('güvensiz adres listeye girmez ve diske yazılmaz', () => {
    const s = memory();
    rememberUrl('sahip/depo#1', s);
    const out = rememberUrl('https://kisi:gizli@github.com/sahip/depo', s);
    expect(out).toEqual(['sahip/depo#1']);
    expect(s.data.get(RECENT_URLS_KEY)).toBe(JSON.stringify(['sahip/depo#1']));
  });

  it('bozuk ya da elle eklenmiş güvensiz kayıtlar okunurken ayıklanır', () => {
    expect(loadRecentUrls(memory({ [RECENT_URLS_KEY]: '{bozuk' }))).toEqual([]);
    expect(loadRecentUrls(memory({ [RECENT_URLS_KEY]: '{"a":1}' }))).toEqual([]);
    const s = memory({ [RECENT_URLS_KEY]: JSON.stringify(['a/b#1', 3, 'https://x:y@github.com/a/b', 'A/B#1', 'c/d']) });
    expect(loadRecentUrls(s)).toEqual(['a/b#1', 'c/d']);
    expect(loadRecentUrls(null)).toEqual([]);
  });
});

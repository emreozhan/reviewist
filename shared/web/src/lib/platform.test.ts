import { describe, expect, it } from 'vitest';
import { pathKey, samePath } from './fsPath';
import { bgClickLabel, intentHint } from './openIntent';
import { detectMac, detectWindows, IS_MAC, modLabel, platformString, samplePathFor } from './platform';
import { pushRecentRepo } from './recentRepos';
import { shortcutRows, tabCycleDelta } from './shortcutRows';
import { typeAheadIndex } from './typeAhead';

describe('platform algılama', () => {
  it('macOS ve Apple dizeleri', () => {
    for (const p of ['macOS', 'MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)', 'iPad', 'iPhone']) expect(detectMac(p)).toBe(true);
    for (const p of ['Windows', 'Win32', 'Linux x86_64', '', undefined, null]) expect(detectMac(p)).toBe(false);
  });

  it('Windows dizeleri', () => {
    expect(detectWindows('Win32')).toBe(true);
    expect(detectWindows('Windows')).toBe(true);
    expect(detectWindows('MacIntel')).toBe(false);
    expect(detectWindows('Darwin')).toBe(false);
    expect(detectWindows(undefined)).toBe(false);
  });

  it('platform dizesi önceliği: userAgentData > platform > userAgent; navigator yoksa boş', () => {
    expect(platformString({ userAgentData: { platform: 'macOS' }, platform: 'Win32', userAgent: 'x' })).toBe('macOS');
    expect(platformString({ platform: 'MacIntel', userAgent: 'x' })).toBe('MacIntel');
    expect(platformString({ userAgent: 'Linux' })).toBe('Linux');
    expect(platformString(undefined)).toBe('');
  });

  it('test ortamında (navigator yok ya da Mac değil) güvenli varsayılanlar', () => {
    expect(modLabel).toBe(IS_MAC ? '⌘' : 'Ctrl');
  });

  it('yer tutucu yol platforma göre', () => {
    expect(samplePathFor(true)).toBe('C:\\projeler\\shop');
    expect(samplePathFor(false)).toBe('~/projeler/shop');
  });

  it('ipuçları verilen değiştirici etiketiyle üretilir', () => {
    expect(bgClickLabel('⌘')).toBe('⌘+tık');
    expect(intentHint('⌘')).toContain('⌘+tık: arka plan sekmesi');
    expect(intentHint('Ctrl')).not.toContain('⌘');
    const mac = shortcutRows('⌘', '⌥').map(([k]) => k).join(' ');
    expect(mac).toContain('⌘+tık');
    expect(mac).toContain('⌥+]');
    expect(mac).not.toMatch(/Ctrl\+tık|Alt\+/);
  });
});

describe('sekme geçişi kısayolu (⌥/Alt + [ ])', () => {
  const ev = (o: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; key: string; code: string }>) => ({ altKey: true, ctrlKey: false, metaKey: false, key: '', code: '', ...o });
  it('e.code ile: macOS ⌥ farklı karakter üretse de çalışır', () => {
    expect(tabCycleDelta(ev({ code: 'BracketRight', key: '‘' }))).toBe(1);
    expect(tabCycleDelta(ev({ code: 'BracketLeft', key: '“' }))).toBe(-1);
    expect(tabCycleDelta(ev({ key: 'PageDown' }))).toBe(1);
    expect(tabCycleDelta(ev({ key: 'PageUp' }))).toBe(-1);
  });
  it('Alt yoksa ya da Ctrl/Meta varsa eşleşmez', () => {
    expect(tabCycleDelta(ev({ altKey: false, code: 'BracketRight' }))).toBe(0);
    expect(tabCycleDelta(ev({ ctrlKey: true, code: 'BracketRight' }))).toBe(0);
    expect(tabCycleDelta(ev({ metaKey: true, code: 'BracketLeft' }))).toBe(0);
    expect(tabCycleDelta(ev({ code: 'KeyW' }))).toBe(0);
  });
});

describe('NFD (macOS ayrışık) dosya adları', () => {
  const nfc = 'Çalışmalar';
  const nfd = nfc.normalize('NFD');

  it('örnek gerçekten farklı kod noktaları içerir', () => {
    expect(nfd).not.toBe(nfc);
  });

  it('typeAhead NFD adı NFC sorguyla (ve tersi) bulur', () => {
    expect(typeAheadIndex(['abc', nfd], 'çal', 0)).toBe(1);
    expect(typeAheadIndex(['abc', nfc], 'çal'.normalize('NFD'), 0)).toBe(1);
  });

  it('pathKey/samePath iki biçimi aynı sayar; yol değeri değişmez', () => {
    expect(pathKey(`/Users/demo/${nfd}`)).toBe(pathKey(`/Users/demo/${nfc}`));
    expect(samePath(`C:\\${nfd}\\x`, `c:/${nfc}/x/`)).toBe(true);
  });

  it('son depolar listesinde NFD/NFC tekrar ayıklanır, ilk yazılan değer korunur', () => {
    const list = pushRecentRepo([`/Users/demo/${nfc}`], `/Users/demo/${nfd}`);
    expect(list).toEqual([`/Users/demo/${nfd}`]);
  });
});

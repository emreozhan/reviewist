import { describe, expect, it } from 'vitest';
import type { NavTarget } from './navTarget';
import type { PeekEntry } from './peekStack';
import { closeTopPeek, MAX_PEEK_DEPTH, peekIdentity, pushPeek, returnToLevel, updatePeek } from './peekStack';

const target = (path: string, extra: Partial<NavTarget> = {}): NavTarget => ({ path, side: 'new', inDiff: true, ...extra });
const entry = (symbolId: string, extra: Partial<NavTarget> = {}): PeekEntry => {
  const t = target(`${symbolId}.java`, extra);
  return { uid: `u-${symbolId}-${extra.line ?? ''}`, identity: peekIdentity(symbolId, t), symbolId, target: t, crumb: symbolId, maximized: false };
};
const ids = (list: PeekEntry[]) => list.map((e) => e.symbolId);

describe('gözatma yığını: ekleme', () => {
  it('en üste ekler; pencere içinden açılan o seviyenin üstüne gelir (üstündekiler kapanır)', () => {
    let s = pushPeek([], entry('A'), 'top').entries;
    s = pushPeek(s, entry('B'), 'top').entries;
    s = pushPeek(s, entry('C'), 1).entries;
    expect(ids(s)).toEqual(['A', 'B', 'C']);
    // 0. seviyedeki pencerenin içinden: B ve C kapanır, D A'nın üstüne.
    s = pushPeek(s, entry('D'), 0).entries;
    expect(ids(s)).toEqual(['A', 'D']);
  });

  it('yeni zincir (orta paneldeki koddan) yığını değiştirir', () => {
    let s = pushPeek([], entry('A'), 'top').entries;
    s = pushPeek(s, entry('B'), 'top').entries;
    const r = pushPeek(s, entry('X'), 'new');
    expect(ids(r.entries)).toEqual(['X']);
    expect(r.reused).toBe(false);
  });

  it('aynı sembol zaten yığındaysa yeni pencere açılmaz, o seviyeye dönülür', () => {
    let s = pushPeek([], entry('A'), 'top').entries;
    s = pushPeek(s, entry('B'), 'top').entries;
    s = pushPeek(s, entry('C'), 'top').entries;
    const r = pushPeek(s, entry('B'), 2);
    expect(r.reused).toBe(true);
    expect(ids(r.entries)).toEqual(['A', 'B']);
    expect(r.entries[1]?.uid).toBe(s[1]?.uid);
    // Yeni zincirde de: zaten yığındaki hedefe dönülür.
    expect(ids(pushPeek(s, entry('A'), 'new').entries)).toEqual(['A']);
  });

  it('çağrı yerleri dosya:satır ile ayrışır (aynı çağıranın iki çağrısı iki pencere)', () => {
    let s = pushPeek([], entry('Caller', { callSite: true, line: 10 }), 'top').entries;
    s = pushPeek(s, entry('Caller', { callSite: true, line: 20 }), 'top').entries;
    expect(s).toHaveLength(2);
    expect(pushPeek(s, entry('Caller', { callSite: true, line: 10 }), 'top').reused).toBe(true);
  });

  it(`en fazla ${MAX_PEEK_DEPTH} seviye: aşılırsa en alttaki düşer`, () => {
    let s: PeekEntry[] = [];
    for (let i = 0; i < MAX_PEEK_DEPTH; i++) s = pushPeek(s, entry(`S${i}`), 'top').entries;
    expect(s).toHaveLength(MAX_PEEK_DEPTH);
    const r = pushPeek(s, entry('Yeni'), 'top');
    expect(r.dropped).toBe(1);
    expect(r.entries).toHaveLength(MAX_PEEK_DEPTH);
    expect(r.entries[0]?.symbolId).toBe('S1');
    expect(r.entries[MAX_PEEK_DEPTH - 1]?.symbolId).toBe('Yeni');
  });
});

describe('gözatma yığını: geri dönüş ve kapatma', () => {
  const base = ['A', 'B', 'C', 'D'].reduce<PeekEntry[]>((s, id) => pushPeek(s, entry(id), 'top').entries, []);

  it('alt seviyeye dönüş üstündekileri kapatır', () => {
    expect(ids(returnToLevel(base, 1))).toEqual(['A', 'B']);
    expect(ids(returnToLevel(base, 0))).toEqual(['A']);
    expect(ids(returnToLevel(base, 9))).toEqual(['A', 'B', 'C', 'D']);
    expect(ids(returnToLevel(base, -1))).toEqual(['A', 'B', 'C', 'D']);
  });

  it('üstteki kapanır; boş yığında değişmez', () => {
    expect(ids(closeTopPeek(base))).toEqual(['A', 'B', 'C']);
    expect(closeTopPeek([])).toEqual([]);
  });

  it('konum/büyütme yalnız ilgili pencereyi günceller', () => {
    const uid = base[2]?.uid ?? '';
    const next = updatePeek(base, uid, { rect: { x: 1, y: 2, w: 300, h: 200 }, maximized: true });
    expect(next[2]).toMatchObject({ maximized: true, rect: { x: 1, y: 2, w: 300, h: 200 } });
    expect(next[1]).toBe(base[1]);
  });
});

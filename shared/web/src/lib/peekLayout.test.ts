import { describe, expect, it } from 'vitest';
import { cascadeRect, clampRect, PEEK_COMPACT_BELOW, PEEK_GAP, PEEK_MIN, PEEK_STEP, peekRectFor } from './peekLayout';

const inside = (r: { x: number; y: number; w: number; h: number }, p: { w: number; h: number }) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= p.w && r.y + r.h <= p.h;

describe('basamaklı (cascade) yerleşim', () => {
  const panel = { w: 1200, h: 800 };

  it('ilk pencere ~%15 sol/üst boşlukla başlar, sağ ve alt boşluk az', () => {
    const r = cascadeRect(0, panel);
    expect(r.x).toBe(180);
    expect(r.y).toBe(120);
    expect(r.x + r.w).toBe(panel.w - PEEK_GAP.right);
    expect(r.y + r.h).toBe(panel.h - PEEK_GAP.bottom);
  });

  it('her seviye sağa ve aşağı kayar, panel içinde kalır', () => {
    const a = cascadeRect(0, panel);
    const b = cascadeRect(1, panel);
    const c = cascadeRect(2, panel);
    expect(b.x - a.x).toBe(PEEK_STEP.x);
    expect(b.y - a.y).toBe(PEEK_STEP.y);
    expect(c.x - b.x).toBe(PEEK_STEP.x);
    for (const r of [a, b, c]) expect(inside(r, panel)).toBe(true);
  });

  it('çok derinde ofset sabitlenir; pencere asgari boyutun altına inmez', () => {
    const deep = cascadeRect(30, panel);
    expect(cascadeRect(31, panel)).toEqual(deep);
    expect(deep.w).toBeGreaterThanOrEqual(PEEK_MIN.w);
    expect(deep.h).toBeGreaterThanOrEqual(PEEK_MIN.h);
    expect(inside(deep, panel)).toBe(true);
  });

  it(`dar panelde (< ${PEEK_COMPACT_BELOW}px) pencereler paneli kaplar, ofset küçülür`, () => {
    const small = { w: 700, h: 600 };
    expect(cascadeRect(0, small)).toEqual({ x: 0, y: 0, w: 700, h: 600 });
    const b = cascadeRect(1, small);
    expect(b.x).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(PEEK_STEP.x);
    expect(inside(b, small)).toBe(true);
    expect(cascadeRect(20, small)).toEqual(cascadeRect(4, small));
  });

  it('alçak panelde üst boşluk pencere sığacak kadar küçülür', () => {
    const low = { w: 1400, h: 360 };
    const r = cascadeRect(0, low);
    expect(inside(r, low)).toBe(true);
    expect(r.h).toBeGreaterThanOrEqual(300);
  });
});

describe('sürüklenen/büyütülen pencere', () => {
  const panel = { w: 1000, h: 700 };

  it('panel dışına taşan konum ve aşırı/küçük boyut sınırlanır', () => {
    expect(clampRect({ x: 900, y: -50, w: 400, h: 300 }, panel)).toEqual({ x: 600, y: 0, w: 400, h: 300 });
    expect(clampRect({ x: 10, y: 10, w: 50, h: 40 }, panel)).toEqual({ x: 10, y: 10, w: PEEK_MIN.w, h: PEEK_MIN.h });
    expect(clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, panel)).toEqual({ x: 0, y: 0, w: 1000, h: 700 });
  });

  it('büyütülmüş pencere paneli kaplar; elle konum basamağı geçersiz kılar', () => {
    expect(peekRectFor(3, panel, { maximized: true })).toEqual({ x: 0, y: 0, w: 1000, h: 700 });
    expect(peekRectFor(3, panel, { maximized: false, rect: { x: 5, y: 6, w: 500, h: 400 } })).toEqual({ x: 5, y: 6, w: 500, h: 400 });
    expect(peekRectFor(1, panel, { maximized: false })).toEqual(cascadeRect(1, panel));
  });
});

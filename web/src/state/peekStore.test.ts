import { beforeEach, describe, expect, it } from 'vitest';
import type { PeekEntry } from '../lib/peekStack';
import { MAX_PEEK_DEPTH, peekIdentity } from '../lib/peekStack';
import { nextPeekUid, usePeek } from './peekStore';

const entry = (symbolId: string): PeekEntry => {
  const target = { path: `${symbolId}.java`, side: 'new' as const, inDiff: false };
  return { uid: nextPeekUid(), identity: peekIdentity(symbolId, target), symbolId, target, crumb: symbolId, maximized: false };
};
const ids = () => usePeek.getState().entries.map((e) => e.symbolId);

describe('gözatma deposu', () => {
  beforeEach(() => {
    usePeek.setState({ reviewId: null, entries: [], notice: null });
    usePeek.getState().reset('r1');
  });

  it('push / closeTop / returnTo / closeAll', () => {
    const s = usePeek.getState();
    s.push(entry('A'), 'top');
    s.push(entry('B'), 'top');
    s.push(entry('C'), 1);
    expect(ids()).toEqual(['A', 'B', 'C']);
    usePeek.getState().closeTop();
    expect(ids()).toEqual(['A', 'B']);
    usePeek.getState().push(entry('D'), 'top');
    usePeek.getState().returnTo(0);
    expect(ids()).toEqual(['A']);
    usePeek.getState().closeAll();
    expect(ids()).toEqual([]);
  });

  it('aynı sembolü yeniden açmak o seviyeye döner', () => {
    const s = usePeek.getState();
    s.push(entry('A'), 'top');
    s.push(entry('B'), 'top');
    s.push(entry('C'), 'top');
    usePeek.getState().push(entry('A'), 2);
    expect(ids()).toEqual(['A']);
  });

  it('derinlik sınırı aşılınca en alttaki düşer ve bilgi notu çıkar', () => {
    for (let i = 0; i <= MAX_PEEK_DEPTH; i++) usePeek.getState().push(entry(`S${i}`), 'top');
    expect(ids()).toHaveLength(MAX_PEEK_DEPTH);
    expect(ids()[0]).toBe('S1');
    expect(usePeek.getState().notice).toMatch(/en alttaki/);
  });

  it('büyütme ve konum yalnız ilgili pencereyi değiştirir; review değişince yığın sıfırlanır', () => {
    usePeek.getState().push(entry('A'), 'top');
    usePeek.getState().push(entry('B'), 'top');
    const uid = usePeek.getState().entries[1]?.uid ?? '';
    usePeek.getState().toggleMaximized(uid);
    usePeek.getState().setRect(uid, { x: 1, y: 1, w: 400, h: 300 });
    expect(usePeek.getState().entries[1]).toMatchObject({ maximized: true, rect: { w: 400 } });
    expect(usePeek.getState().entries[0]?.maximized).toBe(false);
    usePeek.getState().reset('r2');
    expect(ids()).toEqual([]);
  });
});

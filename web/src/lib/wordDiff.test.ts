import { describe, expect, it } from 'vitest';
import type { DiffLine } from '../../../src/shared/types';
import { toSplitRows, wordSegmentsForRows } from './diffPresentation';
import type { DiffRow } from './diffRows';
import { pairWordDiffs, tokenize, wordDiff } from './wordDiff';

describe('wordDiff', () => {
  it('yalnız değişen kelimeleri işaretler', () => {
    const r = wordDiff('boolean charge(Money amount, String customerId)', 'PaymentResult charge(Money amount, String customerId, String key)');
    expect(r.old.filter((s) => s.changed).map((s) => s.text)).toEqual(['boolean']);
    const added = r.new.filter((s) => s.changed).map((s) => s.text).join('');
    expect(added).toContain('PaymentResult');
    expect(added).toContain('key');
    expect(r.similarity).toBeGreaterThan(0.5);
  });

  it('Türkçe harfleri kelime olarak tanır', () => {
    expect(tokenize('ödeme başarısız')).toEqual(['ödeme', ' ', 'başarısız']);
  });

  it('yalnız boşluk farkını değişiklik saymaz', () => {
    const r = wordDiff('a  =  b', 'a = b');
    expect(r.old.some((s) => s.changed)).toBe(false);
    expect(r.new.some((s) => s.changed)).toBe(false);
  });

  it('tamamen farklı satırlarda benzerlik düşüktür ve eşleştirme yapılmaz', () => {
    const lines: DiffLine[] = [
      { type: 'del', oldNo: 1, text: 'return value.equals(other.value);' },
      { type: 'add', newNo: 1, text: 'log.warn("x");' },
    ];
    expect(pairWordDiffs(lines).size).toBe(0);
  });

  it('silme ve ekleme bloklarını sırayla eşler', () => {
    const lines: DiffLine[] = [
      { type: 'context', oldNo: 1, newNo: 1, text: 'x' },
      { type: 'del', oldNo: 2, text: 'int total = order.getTotal();' },
      { type: 'add', newNo: 2, text: 'int total = order.totalAmount();' },
    ];
    const map = pairWordDiffs(lines);
    expect([...map.keys()]).toEqual([1, 2]);
  });
});

describe('diff sunumu', () => {
  const rows: DiffRow[] = [
    { kind: 'line', line: { type: 'context', oldNo: 1, newNo: 1, text: 'a' } },
    { kind: 'line', line: { type: 'del', oldNo: 2, text: 'int x = 1;' } },
    { kind: 'line', line: { type: 'del', oldNo: 3, text: 'int y = 2;' } },
    { kind: 'line', line: { type: 'add', newNo: 2, text: 'int x = 10;' } },
    { kind: 'gap', id: 'g5', oldStart: 4, newStart: 3, count: 4, expandable: false },
    { kind: 'line', line: { type: 'add', newNo: 7, text: 'z' } },
  ];

  it('yan yana görünümde silme/ekleme eşlenir, fazla satır tek taraflı kalır', () => {
    const split = toSplitRows(rows);
    expect(split).toHaveLength(5);
    const second = split[1];
    expect(second?.kind === 'pair' && second.left?.segments && second.right?.segments).toBeTruthy();
    const third = split[2];
    expect(third?.kind === 'pair' && third.left && !third.right).toBe(true);
    expect(split[3]?.kind).toBe('gap');
  });

  it('birleşik görünümde kelime farkı satır indeksine bağlanır', () => {
    const seg = wordSegmentsForRows(rows);
    expect([...seg.keys()]).toEqual([1, 3]);
  });
});

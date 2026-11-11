import { describe, expect, it } from 'vitest';
import type { DiffRow } from './diffRows';
import { indexOfNewLine, splitItems, unifiedItems } from './diffItems';
import type { SymbolMark } from './diffPresentation';
import { toSplitRows } from './diffPresentation';
import { centeredOffset, indexAtOffset, prefixOffsets, windowRange } from './windowing';

describe('pencereleme hesapları', () => {
  it('önek toplamları ve konumdan indeks', () => {
    const o = prefixOffsets([20, 20, 26, 20]);
    expect(Array.from(o)).toEqual([0, 20, 40, 66, 86]);
    expect(indexAtOffset(o, 0)).toBe(0);
    expect(indexAtOffset(o, 39.9)).toBe(1);
    expect(indexAtOffset(o, 40)).toBe(2);
    expect(indexAtOffset(o, 1000)).toBe(3);
    expect(indexAtOffset(prefixOffsets([]), 10)).toBe(0);
  });

  it('görünür aralık payla genişler ve sınırlarda kıstırılır', () => {
    const o = prefixOffsets(new Array<number>(10_000).fill(20));
    expect(windowRange(o, 2000, 2400, 0)).toEqual({ start: 100, end: 121 });
    expect(windowRange(o, 2000, 2400, 200)).toEqual({ start: 90, end: 131 });
    expect(windowRange(o, 0, 400, 1000)).toEqual({ start: 0, end: 71 });
    expect(windowRange(o, 199_800, 200_400, 0).end).toBe(10_000);
    expect(windowRange(prefixOffsets([]), 0, 100, 0)).toEqual({ start: 0, end: 0 });
  });

  it('öğeyi ortalayan kaydırma konumu', () => {
    const o = prefixOffsets(new Array<number>(100).fill(20));
    expect(centeredOffset(o, 50, 400)).toBe(50 * 20 + 10 - 200);
    expect(centeredOffset(o, 1, 400)).toBe(0);
  });
});

describe('diff tablo öğeleri', () => {
  const rows: DiffRow[] = [
    { kind: 'line', line: { type: 'context', oldNo: 1, newNo: 1, text: 'a' } },
    { kind: 'line', line: { type: 'del', oldNo: 2, text: 'b' } },
    { kind: 'line', line: { type: 'add', newNo: 2, text: 'B' } },
    { kind: 'gap', id: 'g3', oldStart: 3, newStart: 3, count: 5, expandable: true },
    { kind: 'line', line: { type: 'context', oldNo: 8, newNo: 8, text: 'c' } },
  ];
  const mark: SymbolMark = { id: 'X#m()', name: 'm()', status: 'modified', isStart: true };
  const newMap = new Map<number, SymbolMark>([[2, mark], [8, mark]]);
  const oldMap = new Map<number, SymbolMark>([[2, mark]]);

  it('üye sınırı ayrı öğe olarak eklenir, gap sonrası yeniden başlar; anahtarlar benzersiz', () => {
    const items = unifiedItems(rows, { oldMap, newMap });
    expect(items.map((i) => i.kind)).toEqual(['line', 'boundary', 'line', 'line', 'gap', 'boundary', 'line']);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(indexOfNewLine(items, 2)).toBe(3);
    expect(indexOfNewLine(items, 8)).toBe(6);
    expect(indexOfNewLine(items, 5)).toBe(-1);
  });

  it('yan yana öğelerde yeni satır sağ taraftan bulunur', () => {
    const items = splitItems(toSplitRows(rows), { oldMap, newMap });
    expect(items.map((i) => i.kind)).toEqual(['pair', 'boundary', 'pair', 'gap', 'boundary', 'pair']);
    expect(indexOfNewLine(items, 2)).toBe(2);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it('harita yoksa sınır satırı üretilmez', () => {
    expect(unifiedItems(rows, {}).some((i) => i.kind === 'boundary')).toBe(false);
  });
});

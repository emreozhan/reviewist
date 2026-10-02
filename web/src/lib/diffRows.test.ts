import { describe, expect, it } from 'vitest';
import { buildDiffRows, sliceRowsByRange } from './diffRows';
import { buildHunks, countChanges } from './hunks';
import { splitLines } from './lcs';

const OLD = ['class A {', '  int a() {', '    return 1;', '  }', '', '  int b() {', '    return 2;', '  }', '', '  int c() {', '    return 3;', '  }', '}'].join('\n') + '\n';
const NEW = ['class A {', '  int a() {', '    return 1;', '  }', '', '  int b() {', '    return 20;', '  }', '', '  int c() {', '    return 3;', '  }', '', '  int d() { return 4; }', '}'].join('\n') + '\n';

describe('buildHunks', () => {
  it('bağlamlı hunk üretir ve satır numaraları içerikle tutarlıdır', () => {
    const hunks = buildHunks(OLD, NEW, 1);
    expect(countChanges(hunks)).toEqual({ additions: 3, deletions: 1 });
    const newLines = splitLines(NEW);
    for (const h of hunks) {
      for (const l of h.lines) {
        if (l.newNo !== undefined) expect(newLines[l.newNo - 1]).toBe(l.text);
      }
    }
    expect(hunks[0]?.oldStart).toBe(6);
  });

  it('eklenen dosyada eski taraf boştur', () => {
    const [h] = buildHunks('', 'a\nb\n');
    expect(h).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 });
  });
});

describe('buildDiffRows', () => {
  const hunks = buildHunks(OLD, NEW, 1);
  const newLines = splitLines(NEW);

  it('içerik yokken hunk arası boşluk açılamaz değildir ama sayı bilinir', () => {
    const rows = buildDiffRows(hunks);
    const gaps = rows.filter((r) => r.kind === 'gap');
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.kind === 'gap' && !g.expandable)).toBe(true);
  });

  it('içerik varsa boşluklar genişletilebilir ve dosyanın tamamı elde edilir', () => {
    const rows = buildDiffRows(hunks, { newLines, expandAll: true });
    expect(rows.every((r) => r.kind === 'line')).toBe(true);
    const newSide = rows.flatMap((r) => (r.kind === 'line' && r.line.type !== 'del' ? [r.line.text] : []));
    expect(newSide).toEqual(newLines);
  });

  it('yalnız istenen boşluk açılır', () => {
    const closed = buildDiffRows(hunks, { newLines });
    const first = closed.find((r) => r.kind === 'gap');
    expect(first?.kind).toBe('gap');
    const opened = buildDiffRows(hunks, { newLines, expandedGaps: new Set([first?.kind === 'gap' ? first.id : '']) });
    expect(opened.filter((r) => r.kind === 'gap').length).toBe(closed.filter((r) => r.kind === 'gap').length - 1);
  });
});

describe('sliceRowsByRange (üye odaklı diff)', () => {
  const hunks = buildHunks(OLD, NEW, 1);
  const full = buildDiffRows(hunks, { newLines: splitLines(NEW), expandAll: true });

  it('değişen üyenin yalnız kendi satırlarını verir', () => {
    const slice = sliceRowsByRange(full, { startLine: 6, endLine: 8 }, { startLine: 6, endLine: 8 });
    const texts = slice.rows.flatMap((r) => (r.kind === 'line' ? [`${r.line.type}:${r.line.text.trim()}`] : []));
    expect(texts).toEqual(['context:int b() {', 'del:return 2;', 'add:return 20;', 'context:}']);
    expect(slice.changed).toBe(true);
    expect(slice.partial).toBe(false);
  });

  it('eklenen üye yalnız yeni aralıkla bulunur', () => {
    const slice = sliceRowsByRange(full, undefined, { startLine: 14, endLine: 14 });
    expect(slice.rows.every((r) => r.kind === 'line' && r.line.type === 'add')).toBe(true);
    expect(slice.rows).toHaveLength(1);
  });

  it('silinen üye yalnız eski aralıkla bulunur', () => {
    const rows = buildDiffRows(buildHunks(NEW, OLD, 1), { newLines: splitLines(OLD), expandAll: true });
    const slice = sliceRowsByRange(rows, { startLine: 14, endLine: 14 }, undefined);
    expect(slice.rows).toHaveLength(1);
    expect(slice.rows.every((r) => r.kind === 'line' && r.line.type === 'del')).toBe(true);
  });

  it('içerik yokken aralık boşluğa düşerse partial işaretlenir', () => {
    const rows = buildDiffRows(hunks);
    const slice = sliceRowsByRange(rows, { startLine: 1, endLine: 4 }, { startLine: 1, endLine: 4 });
    expect(slice.partial).toBe(true);
  });

  it('aralıkta değişiklik yoksa changed false', () => {
    const slice = sliceRowsByRange(full, { startLine: 10, endLine: 12 }, { startLine: 10, endLine: 12 });
    expect(slice.changed).toBe(false);
  });
});

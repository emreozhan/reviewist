import { describe, expect, it } from 'vitest';
import type { SymbolRef } from '../../../src/shared/types';
import { highlightFragment } from './highlight';
import type { RefSpan } from './refMerge';
import { htmlText, injectRefs, normalizeSpans, refsByLine, refSpansFor } from './refMerge';
import { wordDiff } from './wordDiff';

const span = (start: number, end: number, ri = '0'): RefSpan => ({ start, end, cls: 'xref', attrs: { 'data-ri': ri } });

/** Sarılmış parçaların metni (aynı data-ri birleştirilir). */
function wrapped(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<span class="xref[^"]*"[^>]*data-ri="(\d+)"[^>]*>(.*?)<\/span>/g;
  for (const m of html.matchAll(re)) {
    const ri = m[1] ?? '';
    out[ri] = (out[ri] ?? '') + htmlText(m[2] ?? '');
  }
  return out;
}

describe('referans–token birleştirme', () => {
  it('renklendirilmiş Java satırında referans sarılır, metin ve renkler korunur', () => {
    const text = '        result = payments.charge(total, order.customerId(), order.id().toString());';
    const html = highlightFragment(text, 'java');
    const start = text.indexOf('charge');
    const out = injectRefs(html, [span(start, start + 'charge'.length)]);
    expect(htmlText(out)).toBe(text);
    expect(wrapped(out)).toEqual({ '0': 'charge' });
    // hljs span'leri aynen kalır.
    expect(out.match(/<span class="hljs-/g)?.length ?? 0).toBe(html.match(/<span class="hljs-/g)?.length ?? 0);
  });

  it('HTML varlıkları tek karakter sayılır (sütunlar düz metne göre)', () => {
    const text = 'if (a < b && c > d) foo("x");';
    const html = highlightFragment(text, 'java');
    const start = text.indexOf('foo');
    const out = injectRefs(html, [span(start, start + 3)]);
    expect(htmlText(out)).toBe(text);
    expect(wrapped(out)).toEqual({ '0': 'foo' });
  });

  it('etiket sınırını aşan referans parçalara bölünür; iç içe geçme bozulmaz', () => {
    const out = injectRefs('<span class="a">ab</span>cd', [span(1, 3)]);
    expect(out).toBe('<span class="a">a<span class="xref" data-ri="0">b</span></span><span class="xref" data-ri="0">c</span>d');
  });

  it('kelime farkı <mark> parçalarıyla birlikte çalışır', () => {
    const oldText = 'boolean ok = payments.charge(total, id);';
    const newText = 'PaymentResult r = payments.charge(total, id, key);';
    const segs = wordDiff(oldText, newText).new;
    const html = segs.map((s) => (s.changed ? `<mark class="wd wd--add">${highlightFragment(s.text, 'java')}</mark>` : highlightFragment(s.text, 'java'))).join('');
    const a = newText.indexOf('PaymentResult');
    const c = newText.indexOf('charge');
    const out = injectRefs(html, [span(c, c + 6, '1'), span(a, a + 13, '0')]);
    expect(htmlText(out)).toBe(newText);
    expect(wrapped(out)).toEqual({ '0': 'PaymentResult', '1': 'charge' });
    expect(out).toContain('<mark class="wd wd--add">');
  });

  it('UTF-16: BMP dışı karakterden sonra sütunlar kaymaz', () => {
    const text = 's = "😀"; run();';
    const html = highlightFragment(text, 'java');
    const start = text.indexOf('run');
    const out = injectRefs(html, [span(start, start + 3)]);
    expect(wrapped(out)).toEqual({ '0': 'run' });
  });

  it('çakışan, boş ve satır dışı aralıklar yok sayılır', () => {
    expect(normalizeSpans([span(2, 5), span(3, 4), span(6, 6), span(-1, 1)]).map((s) => [s.start, s.end])).toEqual([[2, 5]]);
    expect(injectRefs('abc', [span(10, 12)])).toBe('abc');
    expect(injectRefs('abc', [])).toBe('abc');
  });

  it('satır gruplama hedefsiz referansları atar; aralık sınıfı değişen hedefi işaretler', () => {
    const refs: SymbolRef[] = [
      { line: 3, startCol: 10, endCol: 14, name: 'b', kind: 'call', targets: ['B#b()'] },
      { line: 3, startCol: 2, endCol: 5, name: 'a', kind: 'call', targets: ['A#a()', 'A#a(int)'] },
      { line: 4, startCol: 0, endCol: 1, name: 'x', kind: 'call', targets: [] },
    ];
    const map = refsByLine(refs);
    expect([...map.keys()]).toEqual([3]);
    const spans = refSpansFor(3, map.get(3), (id) => (id === 'A#a(int)' ? 'signatureChanged' : 'unchanged'), (r) => r.name);
    expect(spans.map((s) => s.cls)).toEqual(['xref xref--changed xref--signatureChanged xref--multi', 'xref']);
    expect(spans[0]?.attrs['data-ln']).toBe('3');
  });
});

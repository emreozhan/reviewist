import { describe, expect, it } from 'vitest';
import { escapeHtml, highlightFragment, highlightLines, langFor, splitHighlighted } from './highlight';
import { formatHash, parseHash } from './route';

describe('sözdizimi renklendirme', () => {
  it('çok satırlı yorumda span her satırda yeniden açılır', () => {
    const lines = highlightLines('/**\n * doc\n */\nclass A {}\n', 'java');
    expect(lines).toHaveLength(4);
    for (const l of lines.slice(0, 3)) expect(l).toMatch(/^<span class="hljs-comment">.*<\/span>$/);
    expect(lines[3]).toContain('hljs-keyword');
  });

  it('dil yoksa HTML kaçışlar', () => {
    expect(highlightFragment('<a & b>', null)).toBe('&lt;a &amp; b&gt;');
    expect(escapeHtml('"x"')).toBe('&quot;x&quot;');
  });

  it('span dengesi korunur', () => {
    const out = splitHighlighted('<span class="a">x\ny<span class="b">z\nw</span></span>');
    expect(out).toEqual(['<span class="a">x</span>', '<span class="a">y<span class="b">z</span></span>', '<span class="a"><span class="b">w</span></span>']);
  });

  it('dosya dilini eşler', () => {
    expect(langFor('java')).toBe('java');
    expect(langFor('yaml')).toBe('yaml');
    expect(langFor('other')).toBeNull();
  });
});

describe('hash yönlendirme', () => {
  it('review rotasını parametreleriyle gidip gelir', () => {
    const route = { name: 'review' as const, id: 'r 1', tab: 'graph' as const, params: { file: 'src/A.java', sym: 'a.A#b(int)', view: 'diff' as const, layout: 'split' as const, line: 12 } };
    expect(parseHash(formatHash(route))).toEqual(route);
  });

  it('bilinmeyen rotada başlangıca döner, sekme yoksa çalışma alanı', () => {
    expect(parseHash('#/x')).toEqual({ name: 'home' });
    expect(parseHash('#/review/abc')).toMatchObject({ name: 'review', id: 'abc', tab: 'workspace' });
  });
});

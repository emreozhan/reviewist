import { describe, expect, it } from 'vitest';
import type { SymbolRef } from '../../../src/shared/types';
import { escapeHtml, highlightFragment, highlightLines } from './highlight';
import { htmlText, injectRefs, refSpansFor } from './refMerge';
import { safeHref } from './safeHref';
import { wordDiff } from './wordDiff';

/**
 * Güvenilmez girdiler (kod içeriği, dosya/sembol adı, imza, hata iletisi) `dangerouslySetInnerHTML`'e giden
 * HTML'de etiket ya da öznitelik olarak yorumlanmamalı. Ölçüt: çıktıdaki tüm etiketler beklenen (span/mark)
 * etiketlerdir, olay özniteliği yoktur ve görünen metin girdinin kendisidir.
 */
const PAYLOADS = [
  '</span><img src=x onerror=alert(1)>',
  '" onmouseover="alert(1)',
  "' onmouseover='alert(1)",
  '<script>alert(1)</script>',
  'a & b <c> "d" \'e\'',
  '<svg/onload=alert(1)>',
];

/** HTML'deki etiket adları. */
function tagNames(html: string): string[] {
  return [...html.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map((m) => (m[1] ?? '').toLowerCase());
}

/** Etiketlerin içindeki öznitelik adları. */
function attrNames(html: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    // Tırnaklı değerler tüketilerek taranır: değer içindeki metin öznitelik sanılmaz.
    for (const m of tag.slice(1).matchAll(/\s([^\s=>"']+)(?:="[^"]*")?/g)) out.push((m[1] ?? '').toLowerCase());
  }
  return out;
}

function expectSafe(html: string, allowedTags: string[] = ['span']): void {
  for (const t of tagNames(html)) expect(allowedTags).toContain(t);
  for (const a of attrNames(html)) expect(a.startsWith('on')).toBe(false);
}

describe('XSS: highlight.ts', () => {
  it('escapeHtml beş özel karakteri kaçışlar', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  for (const p of PAYLOADS) {
    it(`dil yokken düz metin kaçışlanır: ${p}`, () => {
      const html = highlightFragment(p, null);
      expectSafe(html, []);
      expect(htmlText(html)).toBe(p);
    });

    for (const lang of ['java', 'xml', 'markdown', 'yaml', 'json', 'sql', 'properties'] as const) {
      it(`highlight.js (${lang}) çıktısı yalnız span üretir: ${p}`, () => {
        const html = highlightFragment(p, lang);
        expectSafe(html);
        expect(htmlText(html)).toBe(p);
      });
    }
  }

  it('satırlara bölme kaçışı bozmaz', () => {
    const code = 'String s = "</span><img src=x onerror=alert(1)>";\n// <script>alert(1)</script>\n';
    const lines = highlightLines(code, 'java');
    for (const l of lines) expectSafe(l);
    expect(lines.map(htmlText).join('\n')).toBe(code.slice(0, -1));
  });
});

describe('XSS: refMerge.ts (referans span öznitelikleri)', () => {
  const ref = (startCol: number, endCol: number, targets: string[]): SymbolRef => ({ line: 1, startCol, endCol, name: 'x', kind: 'call', targets });

  it('title değerindeki tırnak/etiket kaçışlanır, öznitelikten çıkılamaz', () => {
    const code = 'foo.bar(x);';
    const html = highlightFragment(code, 'java');
    const spans = refSpansFor(1, [ref(4, 7, ['a.B#bar()'])], () => undefined, () => '" onmouseover="alert(1)" x="<script>&');
    const out = injectRefs(html, spans);
    expectSafe(out);
    expect(out).toContain('title="&quot; onmouseover=&quot;alert(1)&quot; x=&quot;&lt;script&gt;&amp;"');
    expect(htmlText(out)).toBe(code);
  });

  it('tip adı <script> ve durum adı sınıfa sızamaz', () => {
    const code = 'new X();';
    const spans = refSpansFor(1, [ref(4, 5, ['<script>'])], () => '"><img src=x onerror=alert(1)>', () => '<script>alert(1)</script>');
    const out = injectRefs(highlightFragment(code, 'java'), spans);
    expectSafe(out);
    expect(htmlText(out)).toBe(code);
  });

  it('olay öznitelikleri (on…) ve bilinmeyen adlar atılır', () => {
    const out = injectRefs('abc', [{ start: 0, end: 1, cls: 'xref', attrs: { onclick: 'alert(1)', 'x" onload="y': 'z', title: 't' } }]);
    expect(out).toBe('<span class="xref" title="t">a</span>bc');
  });

  it('kötü niyetli kod içeriğine referans eklemek kaçışı bozmaz', () => {
    const code = '"</span><img src=x onerror=alert(1)>".length()';
    const html = highlightFragment(code, 'java');
    const out = injectRefs(html, refSpansFor(1, [ref(1, 10, ['t'])], () => undefined, () => 't'));
    expectSafe(out);
    expect(htmlText(out)).toBe(code);
  });
});

describe('XSS: kelime farkı <mark>', () => {
  it('değişen parçalar kaçışlanmış metinle <mark> içine sarılır', () => {
    const oldText = 'int a = 1;';
    const newText = 'int a = "</mark><img src=x onerror=alert(1)>";';
    const newSegs = wordDiff(oldText, newText).new;
    // DiffCode.tsx ile aynı üretim.
    const html = newSegs.map((s) => (s.changed ? `<mark class="wd wd--add">${highlightFragment(s.text, 'java')}</mark>` : highlightFragment(s.text, 'java'))).join('');
    expectSafe(html, ['span', 'mark']);
    expect(htmlText(html)).toBe(newText);
  });
});

describe('XSS: dış bağlantılar (safeHref)', () => {
  it('yalnız http/https kabul edilir', () => {
    expect(safeHref('https://github.com/a/b/pull/1')).toBe('https://github.com/a/b/pull/1');
    expect(safeHref('http://ghe.local/a/b/pull/2')).toBe('http://ghe.local/a/b/pull/2');
  });

  it('javascript:, data:, vbscript:, göreli ve bozuk adresler reddedilir', () => {
    for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '/goreli', '//evil.example', 'not a url', '', undefined, null]) {
      expect(safeHref(bad)).toBeUndefined();
    }
  });
});

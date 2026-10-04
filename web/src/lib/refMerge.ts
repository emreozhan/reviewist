import type { SymbolRef } from '../../../src/shared/types';
import { escapeHtml } from './highlight';

/**
 * Koddaki tıklanabilir referansları (SymbolRef aralıkları) renklendirilmiş satır HTML'ine yerleştirir.
 *
 * Satır HTML'i highlight.js çıktısıdır (kaçışlanmış metin + <span>), kelime farkında ayrıca <mark> içerir.
 * Sütunlar düz metin üzerinde 0 tabanlı UTF-16 [start, end) olduğundan HTML'de metin konumu sayılır:
 * etiketler 0, varlıklar (&amp; &lt; …) 1 karakter. Bir referans etiket sınırına denk gelirse her metin parçası
 * ayrı sarılır (iç içe geçme bozulmaz; aynı referansın parçaları aynı `data-ri`'yi taşır).
 */
export interface RefSpan {
  start: number;
  end: number;
  /** Sarmalayıcı sınıfı. */
  cls: string;
  /** Ek öznitelikler (anahtar → ham değer; kaçışlanır). */
  attrs: Record<string, string>;
}

const TOKEN_RE = /<[^>]*>|&#?\w+;|[^<&]+|[<&]/g;

function openTag(s: RefSpan): string {
  const attrs = Object.entries(s.attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join('');
  return `<span class="${escapeHtml(s.cls)}"${attrs}>`;
}

/** Çakışan/boş/negatif aralıkları ayıklar ve başlangıca göre sıralar. */
export function normalizeSpans(spans: readonly RefSpan[]): RefSpan[] {
  const sorted = spans.filter((s) => s.end > s.start && s.start >= 0).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: RefSpan[] = [];
  let lastEnd = -1;
  for (const s of sorted) {
    if (s.start < lastEnd) continue;
    out.push(s);
    lastEnd = s.end;
  }
  return out;
}

export function injectRefs(html: string, spans: readonly RefSpan[]): string {
  const list = normalizeSpans(spans);
  if (list.length === 0) return html;
  let out = '';
  let pos = 0;
  let si = 0;

  /** `len` karakterlik metin parçasını (`raw`: HTML'deki karşılığı, `atomic`: bölünemez varlık) yazar. */
  const emitText = (raw: string, atomic: boolean) => {
    const len = atomic ? 1 : raw.length;
    let consumed = 0;
    while (consumed < len) {
      while (si < list.length && (list[si]?.end ?? 0) <= pos) si++;
      const s = list[si];
      const take = (n: number) => {
        const piece = atomic ? raw : raw.slice(consumed, consumed + n);
        consumed += atomic ? 1 : n;
        pos += atomic ? 1 : n;
        return piece;
      };
      if (!s) {
        out += take(len - consumed);
        continue;
      }
      if (pos < s.start) {
        out += take(Math.min(len - consumed, s.start - pos));
        continue;
      }
      out += openTag(s) + take(Math.min(len - consumed, s.end - pos)) + '</span>';
    }
  };

  for (const token of html.match(TOKEN_RE) ?? []) {
    if (token.startsWith('<') && token.length > 1 && token.endsWith('>')) {
      out += token;
    } else if (token.startsWith('&') && token.length > 1 && token.endsWith(';')) {
      emitText(token, true);
    } else {
      emitText(token, false);
    }
  }
  return out;
}

/** HTML'den düz metin (testler ve doğrulama için). */
export function htmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Referansları satır numarasına göre gruplar (satır içinde sütun sırasıyla). */
export function refsByLine(refs: readonly SymbolRef[]): Map<number, SymbolRef[]> {
  const map = new Map<number, SymbolRef[]>();
  for (const r of refs) {
    if (r.targets.length === 0) continue;
    const list = map.get(r.line);
    if (list) list.push(r);
    else map.set(r.line, [r]);
  }
  for (const list of map.values()) list.sort((a, b) => a.startCol - b.startCol);
  return map;
}

/** Hedeflerden ilk değişmiş olanın durumu (bağlantıdaki renkli nokta için). */
export type StatusOf = (id: string) => string | undefined;

/** Satırın referanslarını sarmalayıcı aralıklarına çevirir. `line`: satır numarası (tıklamada referansı bulmak için). */
export function refSpansFor(line: number, refs: readonly SymbolRef[] | undefined, statusOf: StatusOf, titleOf: (r: SymbolRef) => string): RefSpan[] {
  if (!refs || refs.length === 0) return [];
  return refs.map((r, i) => {
    const changed = r.targets.map(statusOf).find((s) => s !== undefined && s !== 'unchanged');
    const multi = r.targets.length > 1;
    return {
      start: r.startCol,
      end: r.endCol,
      cls: `xref${changed ? ` xref--changed xref--${changed}` : ''}${multi ? ' xref--multi' : ''}`,
      // Klavyeyle erişim: bağlantı odaklanabilir, Enter ile açılır (useCodeRefs).
      attrs: { 'data-ln': String(line), 'data-ri': String(i), title: titleOf(r), role: 'link', tabindex: '0' },
    };
  });
}

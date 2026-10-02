/**
 * tree-sitter-java'nın desteklemediği sözdizimlerinin ayrıştırma öncesi maskelenmesi (B4).
 *
 * Bilinen açık: varargs tip anotasyonu `Object @Nullable ... args` (JLS 8.4.1). tree-sitter-java bunu ERROR yapar,
 * parametre ve sonraki bildirimler kaybolur. Diğer tip-kullanım anotasyonları (`Outer.@A Inner`, `String @A []`,
 * `List<@A String>`, cast, throws, extends, receiver parametresi) hatasız ayrışır; maskelenmez.
 *
 * Maskeleme anotasyon metnini aynı uzunlukta boşlukla değiştirir (satır sonları korunur), böylece tüm konumlar
 * (satır/sütun/bayt) aynı kalır. Maskelenen metnin tokenları `maskedTokens` ile geri verilir; FileCtx bunları
 * normalizasyon tokenlarına ekler, böylece normalizedText/normalizedBody maskelemeden etkilenmez.
 * Maskeleme içerik deterministiktir (yalnız kaynağa bağlı), iki diff tarafı aynı biçimde işlenir.
 */

export interface MaskedSpan {
  s: number;
  e: number;
}

export interface MaskResult {
  /** Ayrıştırıcıya verilecek maskeli kaynak (uzunluk ve satır yapısı aynı). */
  source: string;
  spans: MaskedSpan[];
}

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$]/;

function isWs(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/** i'deki string/char/text block literalinin bitişinden sonraki konum. */
function skipLiteral(src: string, i: number): number {
  if (src.startsWith('"""', i)) {
    let k = i + 3;
    while (k < src.length) {
      if (src[k] === '\\') {
        k += 2;
        continue;
      }
      if (src.startsWith('"""', k)) return k + 3;
      k++;
    }
    return src.length;
  }
  const q = src[i];
  let k = i + 1;
  while (k < src.length && src[k] !== q && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
  return Math.min(src.length, k + 1);
}

/** i'deki yorumun bitişi (yorum değilse i). */
function skipComment(src: string, i: number): number {
  if (src[i] !== '/') return i;
  if (src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl < 0 ? src.length : nl;
  }
  if (src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end < 0 ? src.length : end + 2;
  }
  return i;
}

/** Boşluk ve yorumları atlar. */
function skipTrivia(src: string, i: number): number {
  let k = i;
  for (;;) {
    while (k < src.length && isWs(src[k])) k++;
    const c = skipComment(src, k);
    if (c === k) return k;
    k = c;
  }
}

/** i'de ('@') başlayan anotasyonun bitişi; anotasyon değilse undefined. */
function annotationEnd(src: string, i: number): number | undefined {
  if (src[i] !== '@') return undefined;
  let k = skipTrivia(src, i + 1);
  if (!ID_START.test(src[k] ?? '')) return undefined;
  if (src.startsWith('interface', k) && !ID_PART.test(src[k + 9] ?? '')) return undefined;
  for (;;) {
    while (k < src.length && ID_PART.test(src[k] as string)) k++;
    const dot = skipTrivia(src, k);
    if (src[dot] === '.' && src[dot + 1] !== '.') {
      const next = skipTrivia(src, dot + 1);
      if (!ID_START.test(src[next] ?? '')) return undefined;
      k = next;
      continue;
    }
    break;
  }
  const paren = skipTrivia(src, k);
  if (src[paren] !== '(') return k;
  let depth = 0;
  let j = paren;
  while (j < src.length) {
    const ch = src[j] as string;
    if (ch === '"' || ch === "'") {
      j = skipLiteral(src, j);
      continue;
    }
    const c = skipComment(src, j);
    if (c !== j) {
      j = c;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return undefined;
}

/**
 * Varargs tip anotasyonlarını maskeler: `Tip @A @B(x) ... ad` -> `Tip              ... ad`.
 * Anotasyon dizisinin hemen önünde tip sonu (tanımlayıcı, '>' veya ']') olmalı; yorum/string içleri atlanır.
 * Değişiklik yoksa undefined.
 */
export function maskVarargsAnnotations(src: string): MaskResult | undefined {
  if (!src.includes('...') || !src.includes('@')) return undefined;
  const spans: MaskedSpan[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '"' || ch === "'") {
      i = skipLiteral(src, i);
      continue;
    }
    if (ch === '/') {
      const c = skipComment(src, i);
      if (c !== i) {
        i = c;
        continue;
      }
      i++;
      continue;
    }
    if (ch !== '@') {
      i++;
      continue;
    }
    // ardışık anotasyon dizisi
    const seq: MaskedSpan[] = [];
    let k = i;
    for (;;) {
      const end = annotationEnd(src, k);
      if (end === undefined) break;
      seq.push({ s: k, e: end });
      const next = skipTrivia(src, end);
      if (src[next] !== '@') {
        k = next;
        break;
      }
      k = next;
    }
    if (seq.length === 0) {
      i++;
      continue;
    }
    const last = seq[seq.length - 1] as MaskedSpan;
    const after = skipTrivia(src, last.e);
    let before = i - 1;
    while (before >= 0 && isWs(src[before])) before--;
    const prev = before >= 0 ? (src[before] as string) : '';
    if (src.startsWith('...', after) && (ID_PART.test(prev) || prev === '>' || prev === ']')) spans.push(...seq);
    i = last.e;
  }
  if (spans.length === 0) return undefined;
  let out = '';
  let pos = 0;
  for (const sp of spans) {
    out += src.slice(pos, sp.s) + src.slice(sp.s, sp.e).replace(/[^\r\n]/g, ' ');
    pos = sp.e;
  }
  out += src.slice(pos);
  return { source: out, spans };
}

const TOKEN_RE =
  /"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_$][\w$]*|\d[\w.]*|>>>=|<<=|>>=|>>>|->|::|\+\+|--|&&|\|\||[=!<>+\-*/%&|^]=|<<|\S/g;

/** Maskelenen metnin tokenları (yorumlar hariç), mutlak konumlarıyla. */
export function maskedTokens(src: string, spans: readonly MaskedSpan[]): { s: number; e: number; t: string }[] {
  const out: { s: number; e: number; t: string }[] = [];
  for (const sp of spans) {
    const text = src.slice(sp.s, sp.e);
    for (const m of text.matchAll(TOKEN_RE)) {
      const t = m[0];
      if (t.startsWith('//') || t.startsWith('/*')) continue;
      const s = sp.s + (m.index ?? 0);
      out.push({ s, e: s + t.length, t });
    }
  }
  return out;
}

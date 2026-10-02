/**
 * Java tip adı yardımcıları (metin tabanlı): generic silme, annotation temizleme, id için parametre tipi normalizasyonu.
 */

/** Ardışık boşlukları tek boşluğa indirir ve uçları kırpar. */
export function collapseWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Tip metnindeki `@Ann` / `@Ann(...)` (type-use) annotation'larını atar. */
export function stripAnnotations(text: string): string {
  if (!text.includes('@')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '@' && !text.startsWith('@interface', i)) {
      const m = /^@\s*[\w$]+(?:\s*\.\s*[\w$]+)*\s*/.exec(text.slice(i));
      i += m ? m[0].length : 1;
      if (text[i] === '(') {
        let depth = 0;
        for (; i < text.length; i++) {
          if (text[i] === '(') depth++;
          else if (text[i] === ')') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
        }
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** `<...>` tip argümanlarını (iç içe dahil) atar. */
export function stripTypeArgsRaw(text: string): string {
  if (!text.includes('<')) return text;
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/**
 * Annotation ve generic argümanları silinmiş, boşluksuz tip metni. Niteleme ve `[]` / `...` korunur.
 * 'java.util.List<X>[]' -> 'java.util.List[]', 'Map<String, List<X>>' -> 'Map'
 */
export function stripTypeArgs(text: string): string {
  return stripTypeArgsRaw(stripAnnotations(text)).replace(/\s+/g, '');
}

/** Dizi/varargs soneki ayrılmış hali: { base: 'java.util.List', suffix: '[]' } */
function splitSuffix(clean: string): { base: string; suffix: string } {
  const m = /((?:\[\])|(?:\.\.\.))*$/.exec(clean);
  const suffix = m ? m[0] : '';
  return { base: clean.slice(0, clean.length - suffix.length), suffix };
}

/** Basit ad: son nokta sonrası. */
export function simpleName(qualified: string): string {
  const idx = qualified.lastIndexOf('.');
  return idx >= 0 ? qualified.slice(idx + 1) : qualified;
}

/**
 * Sembol id'si için parametre tipi: generic silinmiş, paket öneki atılmış basit ad; dizi '[]' ve varargs '...' korunur.
 * 'java.util.List<X>[]' -> 'List[]', 'Map<String, List<X>>' -> 'Map', 'String...' -> 'String...'
 */
export function eraseTypeForId(text: string): string {
  const { base, suffix } = splitSuffix(stripTypeArgs(text));
  return simpleName(base) + suffix;
}

/** Çözümleme için temel tip adı: generic, annotation, dizi ve varargs atılmış (niteleme korunur). */
export function baseTypeName(text: string): string {
  return splitSuffix(stripTypeArgs(text)).base;
}

/** Karşılaştırma için: varargs '...' -> '[]'. */
export function normalizeVarargs(erased: string): string {
  return erased.endsWith('...') ? `${erased.slice(0, -3)}[]` : erased;
}

/** '<T extends Foo<T>, U>' -> ['T', 'U'] */
export function typeParamNames(typeParams: string | undefined): string[] {
  if (!typeParams) return [];
  const inner = typeParams.trim().replace(/^</, '').replace(/>$/, '');
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const names: string[] = [];
  for (const p of parts) {
    const m = /([A-Za-z_$][\w$]*)/.exec(stripAnnotations(p));
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

/** Tip metninde geçen tüm (büyük harfle başlayan) basit tip adları: 'Map<String, List<Order>>' -> Map, String, List, Order */
export function referencedSimpleNames(text: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/g;
  for (const m of stripAnnotations(text).matchAll(re)) {
    const seg = simpleName(m[0].replace(/\s+/g, ''));
    if (/^[A-Z]/.test(seg)) out.push(seg);
    // nitelikli adın ilk büyük harfli parçası da (Outer.Inner -> Outer)
    const first = m[0].split('.').map((s) => s.trim()).find((s) => /^[A-Z]/.test(s));
    if (first && first !== seg) out.push(first);
  }
  return out;
}

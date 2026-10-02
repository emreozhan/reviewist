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

// ---------------------------------------------------------------------------
// Kaynak kökü / test yolu
// ---------------------------------------------------------------------------

/** Paket yolunun yaygın ilk segmentleri (paket adı bilinmediğinde kaynak kökü sezgisi için). */
const PACKAGE_HEADS = new Set([
  'com', 'org', 'net', 'io', 'java', 'javax', 'jakarta', 'edu', 'gov', 'de', 'fr', 'uk', 'nl', 'ch', 'jp', 'cn',
  'ru', 'it', 'es', 'br', 'tr', 'dev', 'app', 'me', 'info', 'co', 'sun', 'kotlin', 'scala', 'groovy', 'android',
]);

/**
 * Bir .java dosyasının kaynak kökü: paket dizin yolundan önceki önek (`/` ayraçlı, sonda `/` yok; kök dizindeyse '').
 *  - `packageName` verilirse kesin: 'android/guava/src/com/google/common/base/X.java' + 'com.google.common.base'
 *    -> 'android/guava/src'. Dizin paket yoluyla bitmiyorsa dosyanın dizini döner.
 *  - Verilmezse sezgisel: dizindeki SON `src/main/java` benzeri `java` segmentinden sonrası (`.../src/main/java`)
 *    ya da yaygın paket başı segmentinin (com, org, net, io, ...) SON geçtiği yerden öncesi; hiçbiri yoksa dosyanın dizini.
 *    (Son geçiş kuralı GWT `super/com/...` düzeninde de doğru kökü verir.)
 * JavaFileModel elinde olan çağıranlar `packageName`i geçmelidir; RepoIndex aday seçiminde her zaman paket adını kullanır.
 */
export function sourceRootOf(path: string, packageName?: string): string {
  const norm = path.replace(/\\/g, '/');
  const slash = norm.lastIndexOf('/');
  const dir = slash >= 0 ? norm.slice(0, slash) : '';
  if (packageName !== undefined) {
    if (packageName === '') return dir;
    const pkgPath = packageName.replace(/\./g, '/');
    if (dir === pkgPath) return '';
    if (dir.endsWith(`/${pkgPath}`)) return dir.slice(0, dir.length - pkgPath.length - 1);
    return dir;
  }
  const segs = dir ? dir.split('/') : [];
  for (let i = segs.length - 1; i >= 1; i--) {
    if (segs[i] === 'java' && (segs[i - 1] === 'main' || segs[i - 1] === 'test')) return segs.slice(0, i + 1).join('/');
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    if (PACKAGE_HEADS.has(segs[i] as string)) return segs.slice(0, i).join('/');
  }
  return dir;
}

/** Test kaynağı mı: `src/test/` veya herhangi bir `test`/`tests` dizini altında ya da dosya adı `*Test*.java`. */
export function isTestPath(path: string): boolean {
  const norm = `/${path.replace(/\\/g, '/')}`;
  if (/\/(?:test|tests|testFixtures|it|integrationTest)\//.test(norm)) return true;
  return /Test[^/]*\.java$/.test(norm.slice(norm.lastIndexOf('/') + 1));
}

// ---------------------------------------------------------------------------
// Tip değişkeni normalizasyonu (B9)
// ---------------------------------------------------------------------------

const IDENT_RE = /[A-Za-z_$][\w$]*/g;

/**
 * Tip değişkenlerini pozisyonel yer tutuculara çevirir: `names[i]` -> `${prefix}${i}`.
 * Yalnız önünde '.' olmayan tam tanımlayıcılar değişir ('a.T' dokunulmaz). String/char literal içleri atlanır.
 */
export function renameTypeVars(text: string, map: ReadonlyMap<string, string>): string {
  if (map.size === 0 || !text) return text;
  let out = '';
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"' || ch === "'") {
      let k = i + 1;
      while (k < text.length && text[k] !== ch) k += text[k] === '\\' ? 2 : 1;
      i = k + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch) && (i === 0 || !/[\w$]/.test(text[i - 1] as string))) {
      IDENT_RE.lastIndex = i;
      const m = IDENT_RE.exec(text);
      const word = m ? m[0] : ch;
      const rep = map.get(word);
      let j = i - 1;
      while (j >= 0 && /\s/.test(text[j] as string)) j--;
      if (rep !== undefined && text[j] !== '.') {
        out += text.slice(last, i) + rep;
        last = i + word.length;
      }
      i += word.length;
      continue;
    }
    i++;
  }
  return out + text.slice(last);
}

/** Pozisyonel tip değişkeni haritası: sınıf (dıştan içe) önce `§C<i>`, metot değişkenleri `§M<i>` (gölgeleme: metot kazanır). */
export function typeVarMap(classVars: readonly string[], methodVars: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  classVars.forEach((v, i) => map.set(v, `§C${i}`));
  methodVars.forEach((v, i) => map.set(v, `§M${i}`));
  return map;
}

/**
 * Çağrı argümanlarının statik tip çıkarımı ve parametre tipiyle uyumluluk (overload seçimi; analiz katmanı da kullanır).
 * `src/core/analysis/argTypes.ts` ile aynı dışa açık imzalar (inferArgType, argCompatibility, typeVarsOf) + genişletmeler:
 *  - `null` literali, `X.class`, string birleştirme, dizi oluşturma, tip değişkeni tipli yereller (bilinmiyor sayılır)
 *  - dizi uyumu (eleman tipine göre), yaygın JDK tiplerinin üst tip tablosu (List -> Collection -> Iterable ...)
 * Emin olunamayan her durumda 'unknown' / undefined döner.
 */
import type { JavaFileModel, JavaMember, JavaType, RepoIndexApi } from './model.js';
import { eraseTypeForId, splitArraySuffix, typeParamNames } from './names.js';
import { ID_PART_CHARS, IDENT, IDENT_EXACT_RE } from './names.js';

export type Compat = 'ok' | 'mismatch' | 'unknown';

/** null literalinin çıkarılan tipi (her referans tipine uyar, ilkellere uymaz). */
export const NULL_TYPE = '<null>';

const PRIMITIVES = new Set(['byte', 'short', 'char', 'int', 'long', 'float', 'double', 'boolean']);
const BOX: Record<string, string> = {
  Byte: 'byte',
  Short: 'short',
  Character: 'char',
  Integer: 'int',
  Long: 'long',
  Float: 'float',
  Double: 'double',
  Boolean: 'boolean',
};
const WIDENING: Record<string, readonly string[]> = {
  byte: ['short', 'int', 'long', 'float', 'double'],
  short: ['int', 'long', 'float', 'double'],
  char: ['int', 'long', 'float', 'double'],
  int: ['long', 'float', 'double'],
  long: ['float', 'double'],
  float: ['double'],
  double: [],
  boolean: [],
};

/**
 * Yaygın JDK tiplerinin (basit ad) bilinen tüm üst tipleri. Tabloda olan iki tip arasındaki uyum kesin bilinir.
 * Repo içinde aynı basit adlı bir tip varsa tablo kullanılmaz (çözümleme repo tipini döndürür).
 */
const JDK_SUPERS: Record<string, readonly string[]> = {
  Object: [],
  String: ['CharSequence', 'Comparable', 'Serializable'],
  CharSequence: [],
  StringBuilder: ['CharSequence', 'Appendable', 'Serializable'],
  StringBuffer: ['CharSequence', 'Appendable', 'Serializable'],
  Number: ['Serializable'],
  Byte: ['Number', 'Comparable', 'Serializable'],
  Short: ['Number', 'Comparable', 'Serializable'],
  Integer: ['Number', 'Comparable', 'Serializable'],
  Long: ['Number', 'Comparable', 'Serializable'],
  Float: ['Number', 'Comparable', 'Serializable'],
  Double: ['Number', 'Comparable', 'Serializable'],
  Character: ['Comparable', 'Serializable'],
  Boolean: ['Comparable', 'Serializable'],
  BigInteger: ['Number', 'Comparable', 'Serializable'],
  BigDecimal: ['Number', 'Comparable', 'Serializable'],
  Class: ['Serializable', 'Type'],
  Iterable: [],
  Collection: ['Iterable'],
  List: ['Collection', 'Iterable', 'SequencedCollection'],
  Set: ['Collection', 'Iterable'],
  SortedSet: ['Set', 'Collection', 'Iterable', 'SequencedSet', 'SequencedCollection'],
  NavigableSet: ['SortedSet', 'Set', 'Collection', 'Iterable', 'SequencedSet', 'SequencedCollection'],
  Queue: ['Collection', 'Iterable'],
  Deque: ['Queue', 'Collection', 'Iterable', 'SequencedCollection'],
  ArrayList: ['List', 'Collection', 'Iterable', 'RandomAccess', 'Cloneable', 'Serializable', 'AbstractList', 'AbstractCollection', 'SequencedCollection'],
  LinkedList: ['List', 'Deque', 'Queue', 'Collection', 'Iterable', 'Cloneable', 'Serializable', 'AbstractList', 'AbstractCollection', 'SequencedCollection'],
  HashSet: ['Set', 'Collection', 'Iterable', 'Cloneable', 'Serializable', 'AbstractSet', 'AbstractCollection'],
  LinkedHashSet: ['HashSet', 'Set', 'Collection', 'Iterable', 'Cloneable', 'Serializable', 'SequencedSet', 'SequencedCollection'],
  TreeSet: ['NavigableSet', 'SortedSet', 'Set', 'Collection', 'Iterable', 'Cloneable', 'Serializable', 'SequencedSet', 'SequencedCollection'],
  ArrayDeque: ['Deque', 'Queue', 'Collection', 'Iterable', 'Cloneable', 'Serializable', 'SequencedCollection'],
  Map: [],
  SortedMap: ['Map', 'SequencedMap'],
  NavigableMap: ['SortedMap', 'Map', 'SequencedMap'],
  HashMap: ['Map', 'Cloneable', 'Serializable', 'AbstractMap'],
  LinkedHashMap: ['HashMap', 'Map', 'Cloneable', 'Serializable', 'AbstractMap', 'SequencedMap'],
  TreeMap: ['NavigableMap', 'SortedMap', 'Map', 'Cloneable', 'Serializable', 'AbstractMap', 'SequencedMap'],
  Iterator: [],
  ListIterator: ['Iterator'],
  Enumeration: [],
  Optional: [],
  Locale: ['Cloneable', 'Serializable'],
  TimeZone: ['Cloneable', 'Serializable'],
  Date: ['Cloneable', 'Comparable', 'Serializable'],
  Calendar: ['Cloneable', 'Comparable', 'Serializable'],
  Pattern: ['Serializable'],
  Charset: ['Comparable'],
  Random: ['Serializable'],
  Thread: ['Runnable'],
  Throwable: ['Serializable'],
  Exception: ['Throwable', 'Serializable'],
  RuntimeException: ['Exception', 'Throwable', 'Serializable'],
  Supplier: [],
  Function: [],
  Predicate: [],
  Consumer: [],
  Runnable: [],
  Comparator: [],
};

/** Değer tipleri: ilkel, kutulu ve String. Bunlar arasındaki uyum kesin olarak bilinir. */
function isValueType(t: string): boolean {
  return PRIMITIVES.has(t) || t in BOX || t === 'String';
}

function valueCompatible(arg: string, param: string): boolean {
  if (arg === param) return true;
  if (arg === 'String' || param === 'String') return false;
  const argPrim = PRIMITIVES.has(arg) ? arg : BOX[arg];
  if (PRIMITIVES.has(param)) {
    // ilkel <- ilkel (genişletme) veya kutulu (unboxing + genişletme)
    return argPrim === param || (WIDENING[argPrim ?? ''] ?? []).includes(param);
  }
  // kutulu param: yalnızca aynı ilkelin kutulanması
  return PRIMITIVES.has(arg) && BOX[param] === arg;
}

const INT_RE = /^-?(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*)$/;
const LONG_RE = /^-?(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*)[lL]$/;
const FLOAT_RE = /^-?(?:\d[\d_]*\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fF]$/;
const DOUBLE_RE = /^-?(?:(?:\d[\d_]*\.\d*|\.\d+)(?:[eE][+-]?\d+)?[dD]?|\d[\d_]*(?:[eE][+-]?\d+)[dD]?|\d[\d_]*[dD])$/;
const IDENT_RE = IDENT_EXACT_RE;
const QN = `[${ID_PART_CHARS}.]+`;
const NEW_RE = new RegExp(`^new\\s+(${QN})\\s*(?:<[^()]*>)?\\s*\\(`, 'u');
const NEW_ARRAY_RE = new RegExp(`^new\\s+(${QN})\\s*(?:<[^()]*>)?\\s*((?:\\[[^\\]]*\\]\\s*)+)(?:\\{.*)?$`, 'u');
const CAST_RE = new RegExp(`^\\(\\s*(${QN}(?:\\s*<[^()]*>)?(?:\\s*\\[\\s*\\])*)\\s*\\)\\s*[${ID_PART_CHARS}"'(]`, 'u');
const CLASS_LIT_RE = new RegExp(`^${QN}(?:\\s*\\[\\s*\\])*\\s*\\.\\s*class$`, 'u');
const THIS_FIELD_RE = new RegExp(`^this\\.(${IDENT})$`, 'u');

/** Basit (ilk düzey) string birleştirmesi: üst düzeyde '+' var ve işlenenlerden biri string literal. */
function isStringConcat(t: string): boolean {
  let depth = 0;
  let plus = false;
  let str = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i] as string;
    if (ch === '"') {
      if (depth === 0) str = true;
      let k = i + 1;
      while (k < t.length && t[k] !== '"') k += t[k] === '\\' ? 2 : 1;
      i = k;
      continue;
    }
    if (ch === "'") {
      let k = i + 1;
      while (k < t.length && t[k] !== "'") k += t[k] === '\\' ? 2 : 1;
      i = k;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0) {
      if (ch === '+' && t[i + 1] !== '+' && t[i - 1] !== '+' && t[i + 1] !== '=') plus = true;
      else if (ch === '?' || ch === '=' || ch === '-' || ch === '>' || ch === '<') return false;
    }
  }
  return plus && str;
}

/**
 * Argüman ifadesinin tipi (sembol id biçiminde silinmiş basit ad: 'int', 'String', 'OrderId', 'List[]', NULL_TYPE) veya undefined.
 * `caller` çağrının bulunduğu üye, `callerType` sahibi (alan tipleri için).
 * `lookupField` verilirse yerel/alan bulunamayan tanımlayıcılar için kullanılır (kalıtılan / dış tip alanları).
 * Çağıranın tip değişkeniyle bildirilmiş yereller (T x) bilinmiyor sayılır.
 */
export function inferArgType(
  text: string,
  caller: JavaMember | undefined,
  callerType: JavaType | undefined,
  lookupField?: (name: string) => string | undefined,
): string | undefined {
  const t = text.trim();
  if (!t || t.endsWith('…')) return undefined;
  if (t === 'null') return NULL_TYPE;
  if (t.startsWith('"')) return isStringConcat(t) || /^"(?:\\.|[^"\\])*"$/.test(t) || t.startsWith('"""') ? 'String' : undefined;
  if (/^'(?:[^'\\]|\\.[^']*)'$/.test(t)) return 'char';
  if (t === 'true' || t === 'false') return 'boolean';
  if (LONG_RE.test(t)) return 'long';
  if (INT_RE.test(t)) return 'int';
  if (FLOAT_RE.test(t)) return 'float';
  if (DOUBLE_RE.test(t)) return 'double';
  if (CLASS_LIT_RE.test(t)) return 'Class';
  const declaredType = (declared: string | undefined): string | undefined => {
    if (!declared) return undefined;
    const erased = eraseTypeForId(declared);
    const base = splitArraySuffix(erased).base;
    if (caller && typeVarsOf(caller, callerType).has(base)) return undefined;
    return erased.endsWith('...') ? `${erased.slice(0, -3)}[]` : erased;
  };
  if (IDENT_RE.test(t)) {
    const declared = caller?.localTypes[t] ?? callerType?.fieldTypes[t] ?? lookupField?.(t);
    return declaredType(declared);
  }
  const thisField = THIS_FIELD_RE.exec(t);
  if (thisField?.[1]) {
    const declared = callerType?.fieldTypes[thisField[1]] ?? lookupField?.(thisField[1]);
    return declaredType(declared);
  }
  if (isStringConcat(t)) return 'String';
  const arr = NEW_ARRAY_RE.exec(t);
  if (arr?.[1] && arr[2]) {
    const dims = (arr[2].match(/\[/g) ?? []).length;
    return `${eraseTypeForId(arr[1])}${'[]'.repeat(dims)}`;
  }
  const created = NEW_RE.exec(t);
  if (created?.[1] && !t.includes('{')) return eraseTypeForId(created[1]);
  const cast = CAST_RE.exec(t);
  if (cast?.[1]) return eraseTypeForId(cast[1]);
  return undefined;
}

export interface TypeCtx {
  file?: JavaFileModel;
  type?: JavaType;
}

type IndexLike = Pick<RepoIndexApi, 'resolveTypeName' | 'getType' | 'superTypesOf'>;

function supersTransitive(index: Pick<RepoIndexApi, 'superTypesOf'>, fqn: string): Set<string> {
  const seen = new Set<string>();
  const queue = [fqn];
  while (queue.length) {
    const cur = queue.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...index.superTypesOf(cur));
  }
  return seen;
}

/** Diziye atanabilen dizi dışı tipler. */
const ARRAY_SUPERS = new Set(['Object', 'Cloneable', 'Serializable']);

function stripDim(t: string): { base: string; dims: number } {
  let dims = 0;
  let base = t;
  while (base.endsWith('[]')) {
    base = base.slice(0, -2);
    dims++;
  }
  return { base, dims };
}

/**
 * Argüman tipi `arg` (argCtx bağlamında yazılmış) ile parametre tipi `param` (paramCtx bağlamında) uyumlu mu.
 * `typeVars`: metot ve sahip tipin tip parametreleri (bunlara her referans tipi uyar).
 */
export function argCompatibility(
  index: IndexLike,
  arg: string,
  argCtx: TypeCtx,
  rawParam: string,
  paramCtx: TypeCtx,
  typeVars: ReadonlySet<string>,
): Compat {
  let param = eraseTypeForId(rawParam);
  if (param.endsWith('...')) {
    const base = param.slice(0, -3);
    param = arg.endsWith('[]') ? `${base}[]` : base;
  }
  return typeCompat(index, arg, argCtx, param, paramCtx, typeVars);
}

/**
 * `argCompatibility` gibi, ancak `param` zaten silinmiş ve varargs açılmış tip ('Object[]' veya 'Object').
 * Çıkarılan argüman tipi bildirilmiş tiptir: '[]' içermiyorsa kesinlikle dizi değildir.
 */
export function typeCompat(
  index: IndexLike,
  arg: string,
  argCtx: TypeCtx,
  param: string,
  paramCtx: TypeCtx,
  typeVars: ReadonlySet<string>,
): Compat {
  const p = stripDim(param);
  if (arg === NULL_TYPE) return PRIMITIVES.has(param) ? 'mismatch' : 'ok';
  const a = stripDim(arg);
  if (typeVars.has(p.base)) {
    // T: her tip (ilkel kutulanır); T[]: aynı boyutta referans elemanlı ya da daha çok boyutlu dizi
    if (p.dims === 0) return 'ok';
    if (a.dims < p.dims) return 'mismatch';
    if (a.dims === p.dims && PRIMITIVES.has(a.base)) return 'mismatch';
    return 'ok';
  }
  if (param === 'Object') return 'ok';
  if (arg === param) return 'ok';
  if (a.dims > 0 || p.dims > 0) {
    if (a.dims > 0 && p.dims === 0) return ARRAY_SUPERS.has(param) ? 'ok' : 'mismatch';
    if (a.dims === 0 && p.dims > 0) return 'mismatch'; // dizi olmayan bildirilmiş tip diziye uymaz
    // her ikisi de dizi
    if (a.dims === p.dims) {
      if (PRIMITIVES.has(a.base) || PRIMITIVES.has(p.base)) return a.base === p.base ? 'ok' : 'mismatch';
      return typeCompat(index, a.base, argCtx, p.base, paramCtx, typeVars);
    }
    if (a.dims > p.dims) {
      // Object[][] -> Object[] gibi: fazla boyut eleman olarak Object/Cloneable/Serializable'a uyar
      if (PRIMITIVES.has(p.base)) return 'mismatch';
      return ARRAY_SUPERS.has(p.base) ? 'ok' : 'mismatch';
    }
    return 'mismatch';
  }
  if (isValueType(arg) && isValueType(param)) return valueCompatible(arg, param) ? 'ok' : 'mismatch';
  if (PRIMITIVES.has(param)) {
    // ilkel parametreye yalnız ilkel/kutulu uyar; bilinen başka tip uymaz
    if (arg in JDK_SUPERS) return 'mismatch';
  }
  const argFqn = argCtx.file ? index.resolveTypeName(arg, argCtx.file, argCtx.type) : undefined;
  const paramFqn = paramCtx.file ? index.resolveTypeName(param, paramCtx.file, paramCtx.type) : undefined;
  const argInRepo = !!argFqn && !!index.getType(argFqn);
  const paramInRepo = !!paramFqn && !!index.getType(paramFqn);
  if (argInRepo && paramInRepo) return supersTransitive(index, argFqn as string).has(paramFqn as string) ? 'ok' : 'mismatch';
  if (PRIMITIVES.has(arg) && paramInRepo) return 'mismatch';
  if (PRIMITIVES.has(param) && argInRepo) return 'mismatch';
  // JDK tablosu: iki taraf da tabloda (ve repo tipi değil)
  const argJdk = !argInRepo && arg in JDK_SUPERS;
  const paramJdk = !paramInRepo && param in JDK_SUPERS;
  if ((argJdk || isValueType(arg)) && paramJdk) {
    const argKey = PRIMITIVES.has(arg) ? Object.keys(BOX).find((k) => BOX[k] === arg) ?? arg : arg;
    return argKey === param || (JDK_SUPERS[argKey] ?? []).includes(param) ? 'ok' : 'mismatch';
  }
  if ((argJdk || isValueType(arg)) && paramInRepo) {
    // JDK/değer tipi repo tipine yalnız repo tipi bir JDK arayüzünü... tersine: repo tipi JDK tipinin üstü olamaz
    return 'mismatch';
  }
  if (argInRepo && paramJdk) {
    // repo tipi JDK tipine: üst tip zincirinde ham ad olarak geçiyorsa uyumlu; final JDK sınıfları ve değer tipleri uymaz
    const supers = supersTransitive(index, argFqn as string);
    for (const s of supers) {
      const simple = s.slice(s.lastIndexOf('.') + 1);
      if (simple === param || (JDK_SUPERS[simple] ?? []).includes(param)) return 'ok';
    }
    // çözülemeyen üst tip varsa (repo dışı) emin olunamaz
    for (const s of supers) {
      if (!index.getType(s) && !(s in JDK_SUPERS)) return 'unknown';
    }
    return 'mismatch';
  }
  if (isValueType(param) && argInRepo) return 'mismatch';
  return 'unknown';
}

/** Metot + sahip tipin (ve dış tiplerin bilinen) tip parametre adları. */
export function typeVarsOf(member: JavaMember, owner: JavaType | undefined): Set<string> {
  return new Set([...typeParamNames(member.typeParams), ...typeParamNames(owner?.typeParams)]);
}

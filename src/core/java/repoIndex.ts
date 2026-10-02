/**
 * Repo geneli Java sembol indeksi: tip çözümleme, kalıtım, override ilişkileri ve çağrı grafiği.
 *
 * Çok kaynak köklü repolar (B3): aynı FQN birden çok dosyada bildirilebilir (guava `guava/src` + `android/guava/src`).
 * Tüm adaylar tutulur (`typesByFqn`). Çözümleme (tip, üst tip, alan, çağrı bağlama) çağıranın kaynak köküyle aynı
 * kökteki adayı tercih eder; yoksa varsayılan aday kullanılır.
 * Varsayılan aday (getType / getFileOfType / getMember / superTypesOf bağlamsız çağrıldığında): kaynak kökü en az
 * segmentli olan (eşitlikte sözlük sırasında ilk) aday; ör. `guava/src` < `android/guava/src`.
 * Kaynak kökü: `sourceRootOf(path, packageName)` (paket dizin yolundan önceki önek).
 */
import type { CallRef } from '../../shared/types.js';
import type { CallSite, JavaFileModel, JavaMember, JavaParam, JavaType, RepoIndexApi, ResolvedMember } from './model.js';
import {
  baseTypeName,
  eraseTypeForId,
  normalizeVarargs,
  referencedSimpleNames,
  simpleName,
  sourceRootOf,
  typeParamNames,
} from './names.js';
import { type Compat, inferArgType, typeCompat } from './typeInference.js';

/** Yaygın java.lang tipleri: FQN'e çevrilmez (repo dışı). */
const JAVA_LANG = new Set([
  'Object', 'String', 'Integer', 'Long', 'Short', 'Byte', 'Double', 'Float', 'Boolean', 'Character', 'Number',
  'Math', 'StrictMath', 'System', 'Thread', 'Runnable', 'Exception', 'RuntimeException', 'Error', 'Throwable',
  'IllegalArgumentException', 'IllegalStateException', 'NullPointerException', 'UnsupportedOperationException',
  'IndexOutOfBoundsException', 'ClassCastException', 'ArithmeticException', 'InterruptedException',
  'CloneNotSupportedException', 'Iterable', 'Comparable', 'CharSequence', 'StringBuilder', 'StringBuffer',
  'Class', 'Enum', 'Record', 'Void', 'Override', 'Deprecated', 'SuppressWarnings', 'FunctionalInterface',
  'SafeVarargs', 'AutoCloseable', 'Cloneable', 'Process', 'ProcessBuilder', 'Runtime', 'ThreadLocal',
]);

const MAX_NAME_ONLY = 5;

type Confidence = CallRef['confidence'];

interface TypeEntry {
  type: JavaType;
  file: JavaFileModel;
  root: string;
  typeVars: Set<string>;
  methodsByName: Map<string, JavaMember[]>;
  ctors: JavaMember[];
  /** Doğrudan üst tipler: çözülenler FQN, çözülemeyenler ham ad. */
  supers: string[];
  /** Yalnız repo içinde çözülen doğrudan üst tipler. */
  resolved: string[];
  outer?: TypeEntry;
}

type RecvState = 'self' | 'resolved' | 'external' | 'unknown';

interface SiteRec {
  site: CallSite;
  member: JavaMember;
  type: JavaType;
  file: JavaFileModel;
  entry: TypeEntry;
  state: RecvState;
  recvType?: string; // çözülen alıcı tip FQN
  recvRaw?: string; // çözülemeyen (repo dışı/silinmiş) alıcı tip adı
  targets?: string[]; // bağlanan hedef id'ler
  /** Argüman tipleri tüm adaylarla çelişti; bağlama arity'ye geri düştü (bayat çağrı işareti olabilir). */
  typeConflict?: boolean;
}

interface AnonRec {
  id: string;
  name: string;
  params: JavaParam[];
}

type ExprType = { kind: 'type'; fqn: string } | { kind: 'external'; raw: string } | { kind: 'unknown' };

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function addSetMap<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const s = map.get(key);
  if (s) s.add(value);
  else map.set(key, new Set([value]));
}

function argCompatible(m: JavaMember, argCount: number): boolean {
  if (argCount < 0) return true;
  const n = m.params.length;
  const last = m.params[n - 1];
  if (last?.varargs) return argCount >= n - 1;
  return argCount === n;
}

/** Aşırı yükleme seçimi: tam parametre sayısı eşleşen (varargs olmayan) adaylar öncelikli. */
function preferExact(cands: JavaMember[], argCount: number): JavaMember[] {
  if (cands.length <= 1 || argCount < 0) return cands;
  const exact = cands.filter((m) => m.params.length === argCount && !m.params[m.params.length - 1]?.varargs);
  return exact.length > 0 ? exact : cands;
}

function isStaticOrPrivate(m: JavaMember): boolean {
  return m.modifiers.includes('static') || m.visibility === 'private';
}

const erasedParamsCache = new WeakMap<JavaMember, string[]>();

/** Silinmiş (varargs '[]') parametre tipleri; üye başına önbellekli. */
function erasedParams(m: JavaMember): string[] {
  let e = erasedParamsCache.get(m);
  if (!e) {
    e = m.params.map((p) => normalizeVarargs(eraseTypeForId(p.type)));
    erasedParamsCache.set(m, e);
  }
  return e;
}

/** Overload anahtarı (override edilen üst bildirimleri elemek için). */
function erasedParamKey(m: JavaMember): string {
  return erasedParams(m).join(',');
}

function rootSegments(root: string): number {
  return root ? root.split('/').length : 0;
}

const MAX_CHAIN_CALLS = 4;

interface ChainSeg {
  name: string;
  argc?: number; // tanımlıysa metot çağrısı
}

/** i'deki '(' için eşleşen kapanışı bulur; string/char literal ve text block'ları atlar; derinlik 1'deki virgülleri sayar. */
function scanBalanced(text: string, i: number): { end: number; commas: number; empty: boolean } | undefined {
  if (text[i] !== '(') return undefined;
  let depth = 0;
  let commas = 0;
  let content = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j] as string;
    if (ch === '"' || ch === "'") {
      if (text.startsWith('"""', j)) {
        const close = text.indexOf('"""', j + 3);
        if (close < 0) return undefined;
        j = close + 2;
      } else {
        let k = j + 1;
        while (k < text.length && text[k] !== ch) k += text[k] === '\\' ? 2 : 1;
        j = k;
      }
      content = true;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return { end: j, commas, empty: !content };
    } else if (ch === ',' && depth === 1) commas++;
    if (depth >= 1 && j > i && !/\s/.test(ch) && ch !== ')') content = true;
  }
  return undefined;
}

/** Alıcı metnini zincire böler: 'a.b(x, y).c()' -> a, b/2, c/0. Desteklenmeyen sözdiziminde undefined. */
function parseChain(text: string): { head?: string; segs: ChainSeg[] } | undefined {
  let pos = 0;
  let head: string | undefined;
  const skipWs = (): void => {
    while (pos < text.length && /\s/.test(text[pos] as string)) pos++;
  };
  const newM = /^new\s+([\w$.]+)\s*(?:<[^(]*>)?\s*(?=\()/.exec(text);
  if (newM?.[1]) {
    const b = scanBalanced(text, newM[0].length);
    if (!b) return undefined;
    head = newM[1];
    pos = b.end + 1;
  } else if (text[0] === '(') {
    const b = scanBalanced(text, 0);
    if (!b) return undefined;
    const cast = /^\(\s*\(\s*([\w$.]+)\s*(?:<.*>)?\s*\)/.exec(text.slice(0, b.end + 1));
    if (!cast?.[1]) return undefined;
    head = cast[1];
    pos = b.end + 1;
  }
  if (head !== undefined) {
    skipWs();
    if (pos >= text.length) return { head, segs: [] };
    if (text[pos] !== '.') return undefined; // anonim sınıf gövdesi, dizi erişimi vb.
    pos++;
  }
  const segs: ChainSeg[] = [];
  while (pos < text.length) {
    skipWs();
    if (text[pos] === '<') {
      let depth = 0;
      for (; pos < text.length; pos++) {
        if (text[pos] === '<') depth++;
        else if (text[pos] === '>' && --depth === 0) break;
      }
      pos++;
      skipWs();
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(text.slice(pos));
    if (!id) return undefined;
    pos += id[0].length;
    skipWs();
    const seg: ChainSeg = { name: id[0] };
    if (text[pos] === '(') {
      const b = scanBalanced(text, pos);
      if (!b) return undefined;
      seg.argc = b.empty ? 0 : b.commas + 1;
      pos = b.end + 1;
      skipWs();
    }
    segs.push(seg);
    if (pos >= text.length) break;
    if (text[pos] !== '.') return undefined; // dizi erişimi vb.
    pos++;
  }
  return head !== undefined ? { head, segs } : { segs };
}

function siteKey(fromId: string, line: number, name: string): string {
  return `${fromId}\u0000${line}\u0000${name}`;
}

export class RepoIndex implements RepoIndexApi {
  readonly files: ReadonlyMap<string, JavaFileModel>;
  /** FQN -> varsayılan aday. */
  private readonly typeMap = new Map<string, TypeEntry>();
  /** FQN -> tüm adaylar (kaynak sırasıyla). */
  private readonly typeCands = new Map<string, TypeEntry[]>();
  private readonly entryByType = new Map<JavaType, TypeEntry>();
  private readonly entries: TypeEntry[] = [];
  private readonly memberMap = new Map<string, ResolvedMember>();
  private readonly memberOwner = new Map<JavaMember, TypeEntry>();
  private readonly subMap = new Map<string, string[]>();
  private readonly methodsByName = new Map<string, ResolvedMember[]>();
  private readonly callersMap = new Map<string, CallRef[]>();
  private readonly calleesMap = new Map<string, Set<string>>();
  private readonly sitesByName = new Map<string, SiteRec[]>();
  private readonly siteTargets = new Map<string, Set<string>>();
  private readonly filesBySimpleRef = new Map<string, Set<string>>();
  private readonly filesByImport = new Map<string, Set<string>>();
  private readonly resolveCache = new WeakMap<JavaFileModel, Map<string, string | undefined>>();
  private readonly fileRoots = new WeakMap<JavaFileModel, string>();
  private readonly anonBySuper = new Map<string, AnonRec[]>();
  private supersReady = false;
  /** Çözümleme bağlamı: tercih edilen kaynak kökü (yalnız aynı FQN'li birden çok aday varsa etkili). */
  private curRoot: string | undefined;

  private constructor(files: JavaFileModel[]) {
    const map = new Map<string, JavaFileModel>();
    for (const f of files) map.set(f.path, f);
    this.files = map;
  }

  /** Dosya modellerinden indeksi kurar (çağrı çözümlemesi dahil, tek seferlik). */
  static build(files: JavaFileModel[]): RepoIndex {
    const idx = new RepoIndex(files);
    idx.registerAll();
    idx.computeSupers();
    idx.indexReferences();
    idx.registerAnonymous();
    idx.resolveAllCalls();
    return idx;
  }

  // -------------------------------------------------------------------------
  // Kurulum
  // -------------------------------------------------------------------------

  private rootOf(file: JavaFileModel): string {
    let r = this.fileRoots.get(file);
    if (r === undefined) {
      r = sourceRootOf(file.path, file.packageName);
      this.fileRoots.set(file, r);
    }
    return r;
  }

  private registerAll(): void {
    for (const file of this.files.values()) {
      const root = this.rootOf(file);
      const local = new Map<string, TypeEntry>();
      for (const type of file.types) {
        const entry: TypeEntry = {
          type,
          file,
          root,
          typeVars: new Set(typeParamNames(type.typeParams)),
          methodsByName: new Map(),
          ctors: [],
          supers: [],
          resolved: [],
        };
        if (type.outerFqn) {
          const o = local.get(type.outerFqn);
          if (o) entry.outer = o;
        }
        local.set(type.fqn, entry);
        this.entries.push(entry);
        this.entryByType.set(type, entry);
        pushMap(this.typeCands, type.fqn, entry);
        for (const m of type.members) {
          this.memberOwner.set(m, entry);
          if (m.kind === 'method') pushMap(entry.methodsByName, m.name, m);
          else if (m.kind === 'constructor') entry.ctors.push(m);
        }
      }
    }
    // varsayılan adaylar: en kısa kaynak kökü
    for (const [fqn, cands] of this.typeCands) {
      let best = cands[0] as TypeEntry;
      for (const c of cands) {
        const d = rootSegments(c.root) - rootSegments(best.root);
        if (d < 0 || (d === 0 && c.root < best.root)) best = c;
      }
      this.typeMap.set(fqn, best);
    }
    // üye haritası: önce varsayılan adaylar, sonra (yalnız varsayılanda olmayan id'ler için) diğerleri
    const defaults = [...this.typeMap.values()];
    const others = this.entries.filter((e) => this.typeMap.get(e.type.fqn) !== e);
    for (const e of defaults) {
      for (const m of e.type.members) {
        if (!this.memberMap.has(m.id)) this.memberMap.set(m.id, { member: m, type: e.type, file: e.file });
        if (m.kind === 'method') pushMap(this.methodsByName, m.name, { member: m, type: e.type, file: e.file });
      }
    }
    for (const e of others) {
      for (const m of e.type.members) {
        if (!this.memberMap.has(m.id)) this.memberMap.set(m.id, { member: m, type: e.type, file: e.file });
      }
    }
  }

  /** Bağlamdaki kaynak köküne göre FQN adayı. */
  private entry(fqn: string): TypeEntry | undefined {
    const def = this.typeMap.get(fqn);
    if (!def || this.curRoot === undefined || def.root === this.curRoot) return def;
    const cands = this.typeCands.get(fqn);
    if (!cands || cands.length === 1) return def;
    return cands.find((c) => c.root === this.curRoot) ?? def;
  }

  private withRoot<T>(root: string | undefined, fn: () => T): T {
    const prev = this.curRoot;
    this.curRoot = root;
    try {
      return fn();
    } finally {
      this.curRoot = prev;
    }
  }

  private supersOf(fqn: string): string[] {
    return this.entry(fqn)?.resolved ?? [];
  }

  private computeSupers(): void {
    const subs = new Map<string, Set<string>>();
    for (const entry of this.entries) {
      const t = entry.type;
      const fqn = t.fqn;
      const raws = [...(t.superclass ? [t.superclass] : []), ...t.interfaces];
      this.withRoot(entry.root, () => {
        for (const raw of raws) {
          const r = this.resolveTypeName(raw, entry.file, t);
          if (r && r !== fqn) {
            entry.supers.push(r);
            entry.resolved.push(r);
            addSetMap(subs, r, fqn);
          } else entry.supers.push(raw);
        }
      });
    }
    for (const [k, v] of subs) this.subMap.set(k, [...v]);
    this.supersReady = true;
  }

  private indexReferences(): void {
    for (const file of this.files.values()) {
      const names = new Set<string>();
      const add = (text: string | undefined): void => {
        if (!text) return;
        for (const n of referencedSimpleNames(text)) names.add(n);
      };
      // B13: dosyadaki tüm büyük harfli tanımlayıcılar (alan erişimi niteleyicisi, anotasyon argümanı, X.class, cast...)
      for (const n of file.typeRefs ?? []) names.add(n);
      for (const t of file.types) {
        add(t.superclass);
        t.interfaces.forEach(add);
        t.annotations.forEach(add);
        Object.values(t.fieldTypes).forEach(add);
        for (const m of t.members) {
          m.annotations.forEach(add);
          m.params.forEach((p) => add(p.type));
          add(m.returnType);
          add(m.fieldType);
          m.throws.forEach(add);
          Object.values(m.localTypes).forEach(add);
          for (const s of m.callSites) {
            if (s.isConstructor) add(s.name);
            else if (s.receiver && (s.receiverKind === 'identifier' || s.receiverKind === 'field-access')) {
              const first = s.receiver.split('.')[0] ?? '';
              if (/^[A-Z]/.test(first)) add(s.receiver);
            }
          }
        }
      }
      for (const n of names) addSetMap(this.filesBySimpleRef, n, file.path);
      for (const imp of file.imports) {
        addSetMap(this.filesByImport, imp.name, file.path);
        // statik import: sahip tip de referans sayılır (import static a.Util.helper -> a.Util)
        if (imp.static && !imp.wildcard) addSetMap(this.filesByImport, imp.name.slice(0, imp.name.lastIndexOf('.')), file.path);
      }
    }
  }

  /** Anonim sınıf metotlarını üst tiplerine göre kaydeder (overriddenBy için sentetik id'ler). */
  private registerAnonymous(): void {
    for (const e of this.entries) {
      for (const m of e.type.members) {
        if (!m.anonymousClasses?.length) continue;
        this.withRoot(e.root, () => {
          m.anonymousClasses?.forEach((a, i) => {
            const fqn = this.resolveTypeName(a.superType, e.file, e.type);
            if (!fqn) return;
            for (const am of a.methods) {
              const id = `${m.id}$anon${i + 1}#${am.name}(${am.params.map((p) => eraseTypeForId(p.type)).join(',')})`;
              pushMap(this.anonBySuper, fqn, { id, name: am.name, params: am.params });
            }
          });
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tip çözümleme
  // -------------------------------------------------------------------------

  private outerOf(t: JavaType): JavaType | undefined {
    const e = this.entryByType.get(t);
    if (e?.outer) return e.outer.type;
    return t.outerFqn ? this.entry(t.outerFqn)?.type : undefined;
  }

  private isTypeVar(name: string, fromType: JavaType | undefined, member?: JavaMember): boolean {
    const n = baseTypeName(name);
    if (member && typeParamNames(member.typeParams).includes(n)) return true;
    for (let t = fromType; t; t = this.outerOf(t)) {
      const e = this.entryByType.get(t);
      if (e ? e.typeVars.has(n) : typeParamNames(t.typeParams).includes(n)) return true;
      // statik iç tip (ve örtük statik enum/record/interface) dış tipin tip değişkenlerini görmez
      if (t.modifiers.includes('static') || t.kind !== 'class') break;
    }
    return false;
  }

  /** Tip ve dış tiplerinin (statik olmayan iç sınıf zinciri) tip değişkenleri + metot tip değişkenleri. */
  private typeVarsFor(member: JavaMember, type: JavaType | undefined): Set<string> {
    const out = new Set(typeParamNames(member.typeParams));
    for (let t = type; t; t = this.outerOf(t)) {
      for (const v of this.entryByType.get(t)?.typeVars ?? typeParamNames(t.typeParams)) out.add(v);
      if (t.modifiers.includes('static') || t.kind !== 'class') break;
    }
    return out;
  }

  private resolveSimple(name: string, file: JavaFileModel, fromType: JavaType | undefined): string | undefined {
    if (fromType && this.isTypeVar(name, fromType)) return undefined;
    // iç tip / kendisi / dış tipler
    for (let t = fromType; t; t = this.outerOf(t)) {
      if (t.name === name) return t.fqn;
      const nested = `${t.fqn}.${name}`;
      if (this.typeMap.has(nested)) return nested;
      if (this.supersReady) {
        const inh = this.findInheritedNested(t.fqn, name);
        if (inh) return inh;
      }
    }
    // tekil import
    for (const imp of file.imports) {
      if (imp.wildcard) continue;
      if (simpleName(imp.name) === name) {
        if (this.typeMap.has(imp.name)) return imp.name;
        if (!imp.static) return undefined; // repo dışı tip gölgeler
      }
    }
    // aynı paket
    const same = file.packageName ? `${file.packageName}.${name}` : name;
    if (this.typeMap.has(same)) return same;
    // wildcard importlar
    for (const imp of file.imports) {
      if (!imp.wildcard) continue;
      const cand = `${imp.name}.${name}`;
      if (this.typeMap.has(cand)) return cand;
    }
    if (JAVA_LANG.has(name)) return undefined;
    return undefined;
  }

  private findInheritedNested(fqn: string, name: string): string | undefined {
    const seen = new Set<string>([fqn]);
    const queue = [...this.supersOf(fqn)];
    while (queue.length) {
      const s = queue.shift() as string;
      if (seen.has(s)) continue;
      seen.add(s);
      const cand = `${s}.${name}`;
      if (this.typeMap.has(cand)) return cand;
      queue.push(...this.supersOf(s));
    }
    return undefined;
  }

  resolveTypeName(name: string, fromFile: JavaFileModel, fromType?: JavaType): string | undefined {
    const clean = baseTypeName(name);
    if (!clean) return undefined;
    let cache = this.resolveCache.get(fromFile);
    if (!cache) {
      cache = new Map();
      this.resolveCache.set(fromFile, cache);
    }
    const key = `${fromType?.fqn ?? ''}|${clean}|${this.supersReady ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const result = this.withRoot(this.rootOf(fromFile), () => {
      if (!clean.includes('.')) return this.resolveSimple(clean, fromFile, fromType);
      if (this.typeMap.has(clean)) return clean;
      const segs = clean.split('.');
      const head = this.resolveSimple(segs[0] as string, fromFile, fromType);
      if (head) {
        const cand = [head, ...segs.slice(1)].join('.');
        if (this.typeMap.has(cand)) return cand;
      }
      return undefined;
    });
    cache.set(key, result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Basit sorgular
  // -------------------------------------------------------------------------

  getType(fqn: string): JavaType | undefined {
    return this.entry(fqn)?.type;
  }

  getFileOfType(fqn: string): JavaFileModel | undefined {
    return this.entry(fqn)?.file;
  }

  /** Varsayılan adaydaki üye (bkz. dosya başı); aynı id başka kökte de olabilir: `typesByFqn` ile tüm adaylar. */
  getMember(id: string): ResolvedMember | undefined {
    return this.memberMap.get(id);
  }

  typesByFqn(fqn: string): { type: JavaType; file: JavaFileModel }[] {
    return (this.typeCands.get(fqn) ?? []).map((e) => ({ type: e.type, file: e.file }));
  }

  superTypesOf(fqn: string): string[] {
    return [...(this.entry(fqn)?.supers ?? [])];
  }

  subTypesOf(fqn: string, transitive = false): string[] {
    const direct = this.subMap.get(fqn) ?? [];
    if (!transitive) return [...direct];
    const out: string[] = [];
    const seen = new Set<string>([fqn]);
    const queue = [...direct];
    while (queue.length) {
      const s = queue.shift() as string;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      queue.push(...(this.subMap.get(s) ?? []));
    }
    return out;
  }

  private superTypesTransitive(fqn: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>([fqn]);
    const queue = [...this.supersOf(fqn)];
    while (queue.length) {
      const s = queue.shift() as string;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      queue.push(...this.supersOf(s));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Override ilişkileri
  // -------------------------------------------------------------------------

  private paramsCompatible(a: JavaMember, at: JavaType, b: { params: JavaParam[] }, bt: JavaType, bMember?: JavaMember): boolean {
    if (a.params.length !== b.params.length) return false;
    for (let i = 0; i < a.params.length; i++) {
      const pa = normalizeVarargs(eraseTypeForId((a.params[i] as JavaParam).type));
      const pb = normalizeVarargs(eraseTypeForId((b.params[i] as JavaParam).type));
      if (pa === pb) continue;
      const ba = pa.replace(/\[\]/g, '');
      const bb = pb.replace(/\[\]/g, '');
      if (this.isTypeVar(ba, at, a) || this.isTypeVar(bb, bt, bMember)) continue;
      return false;
    }
    return true;
  }

  private overrideMatchMembers(m: JavaMember, mt: JavaType, otherFqn: string): JavaMember[] {
    const e = this.entry(otherFqn);
    if (!e) return [];
    const out: JavaMember[] = [];
    for (const cand of e.methodsByName.get(m.name) ?? []) {
      if (isStaticOrPrivate(cand)) continue;
      if (this.paramsCompatible(m, mt, cand, e.type, cand)) out.push(cand);
    }
    return out;
  }

  private overrideMatches(m: JavaMember, mt: JavaType, otherFqn: string): string[] {
    return this.overrideMatchMembers(m, mt, otherFqn).map((c) => c.id);
  }

  /** Somut (abstract olmayan, gövdeli) uyumlu metot id'leri. */
  private concreteMatches(m: JavaMember, mt: JavaType, otherFqn: string): string[] {
    return this.overrideMatchMembers(m, mt, otherFqn)
      .filter((c) => !c.modifiers.includes('abstract') && c.normalizedBody !== '')
      .map((c) => c.id);
  }

  /** sub'dan (dahil) ancestor'a (hariç) uzanan alt tip yolunda m ile uyumlu bir bildirim var mı? */
  private declaresBetween(m: JavaMember, mt: JavaType, sub: string, ancestor: string): boolean {
    const pathTypes = new Set(this.subTypesOf(ancestor, true));
    const seen = new Set<string>();
    const queue = [sub];
    while (queue.length) {
      const t = queue.shift() as string;
      if (t === ancestor || seen.has(t) || !pathTypes.has(t)) continue;
      seen.add(t);
      if (this.overrideMatches(m, mt, t).length > 0) return true;
      queue.push(...this.supersOf(t));
    }
    return false;
  }

  overridesOf(memberId: string): string[] {
    const rm = this.memberMap.get(memberId);
    if (!rm || rm.member.kind !== 'method' || isStaticOrPrivate(rm.member)) return [];
    return this.withRoot(this.rootOf(rm.file), () => {
      const out = new Set<string>();
      const supers = this.superTypesTransitive(rm.type.fqn);
      for (const s of supers) for (const id of this.overrideMatches(rm.member, rm.type, s)) out.add(id);
      // Kalıtımla karşılama: C extends B implements I; B#m, C üzerinden I#m'yi karşılar.
      if (!rm.member.modifiers.includes('abstract') && rm.member.normalizedBody !== '') {
        const subs = this.subTypesOf(rm.type.fqn, true);
        const related = new Set([rm.type.fqn, ...supers, ...subs]);
        for (const sub of subs) {
          if (this.declaresBetween(rm.member, rm.type, sub, rm.type.fqn)) continue;
          for (const x of this.superTypesTransitive(sub)) {
            if (related.has(x)) continue;
            for (const id of this.overrideMatches(rm.member, rm.type, x)) out.add(id);
          }
        }
      }
      return [...out];
    });
  }

  /**
   * Alt tiplerde (geçişli) override edenler + (Tur 3) anonim sınıflardaki implementasyonlar:
   * sentetik id `${kapsayan üye id}$anon${n}#${ad}(${parametreler})` (getMember ile çözülmez).
   */
  overriddenBy(memberId: string): string[] {
    const rm = this.memberMap.get(memberId);
    if (!rm || rm.member.kind !== 'method' || isStaticOrPrivate(rm.member)) return [];
    return this.withRoot(this.rootOf(rm.file), () => {
      const out = new Set<string>();
      const subs = this.subTypesOf(rm.type.fqn, true);
      for (const s of subs) for (const id of this.overrideMatches(rm.member, rm.type, s)) out.add(id);
      // Kalıtımla karşılama: metodu kendisi bildirmeyen alt tip S, bu tiple ilgisiz bir üst tipten (B) somut implementasyon alır.
      const related = new Set([rm.type.fqn, ...subs, ...this.superTypesTransitive(rm.type.fqn)]);
      for (const s of subs) {
        if (this.overrideMatches(rm.member, rm.type, s).length > 0) continue;
        for (const x of this.superTypesTransitive(s)) {
          if (related.has(x)) continue;
          for (const id of this.concreteMatches(rm.member, rm.type, x)) out.add(id);
        }
      }
      // anonim sınıflar
      for (const t of [rm.type.fqn, ...subs]) {
        for (const a of this.anonBySuper.get(t) ?? []) {
          if (a.name !== rm.member.name) continue;
          const st = this.entry(t)?.type ?? rm.type;
          if (this.paramsCompatible(rm.member, rm.type, a, st)) out.add(a.id);
        }
      }
      return [...out];
    });
  }

  // -------------------------------------------------------------------------
  // Çağrı çözümleme
  // -------------------------------------------------------------------------

  /** Tip ve üst tiplerinde (BFS) adı/argüman sayısı uyan ilk seviyedeki metotlar. */
  private findInHierarchy(fqn: string, name: string, argCount: number): JavaMember[] {
    const seen = new Set<string>();
    let level = [fqn];
    while (level.length) {
      const found: JavaMember[] = [];
      const next: string[] = [];
      for (const t of level) {
        if (seen.has(t)) continue;
        seen.add(t);
        const e = this.entry(t);
        if (!e) continue;
        for (const m of e.methodsByName.get(name) ?? []) if (argCompatible(m, argCount)) found.push(m);
        next.push(...e.resolved);
      }
      if (found.length) return preferExact(found, argCount);
      level = next;
    }
    return [];
  }

  /** Tüm hiyerarşideki (tüm seviyeler) ad/arity uyumlu overload'lar; alt seviyede override edilen üst bildirimler elenir. */
  private overloadsInHierarchy(fqn: string, name: string, argCount: number): JavaMember[] {
    const seen = new Set<string>();
    const keys = new Set<string>();
    const out: JavaMember[] = [];
    let level = [fqn];
    while (level.length) {
      const next: string[] = [];
      const levelKeys: string[] = [];
      for (const t of level) {
        if (seen.has(t)) continue;
        seen.add(t);
        const e = this.entry(t);
        if (!e) continue;
        for (const m of e.methodsByName.get(name) ?? []) {
          if (!argCompatible(m, argCount)) continue;
          const k = erasedParamKey(m);
          if (keys.has(k)) continue;
          levelKeys.push(k);
          out.push(m);
        }
        next.push(...e.resolved);
      }
      for (const k of levelKeys) keys.add(k);
      level = next;
    }
    return out;
  }

  /** Alanın bildirilen tipi (tip, üst tipleri ve dış tipleri boyunca). */
  private findFieldType(fromType: JavaType, field: string, withOuter: boolean): { declared: string; owner: TypeEntry } | undefined {
    const visit = (t: JavaType): { declared: string; owner: TypeEntry } | undefined => {
      const e = this.entryByType.get(t) ?? this.entry(t.fqn);
      if (e) {
        const d = e.type.fieldTypes[field];
        if (d !== undefined) return { declared: d, owner: e };
      }
      for (const s of this.superTypesTransitive(t.fqn)) {
        const se = this.entry(s);
        const d = se?.type.fieldTypes[field];
        if (se && d !== undefined) return { declared: d, owner: se };
      }
      return undefined;
    };
    for (let t: JavaType | undefined = fromType; t; t = withOuter ? this.outerOf(t) : undefined) {
      const r = visit(t);
      if (r) return r;
    }
    return undefined;
  }

  private declaredToExpr(declared: string, file: JavaFileModel, type: JavaType, member?: JavaMember): ExprType {
    if (this.isTypeVar(declared, type, member)) return { kind: 'unknown' };
    if (/(\[\]|\.\.\.)\s*$/.test(declared.replace(/<.*>/g, ''))) return { kind: 'external', raw: declared }; // dizi
    const fqn = this.resolveTypeName(declared, file, type);
    return fqn ? { kind: 'type', fqn } : { kind: 'external', raw: baseTypeName(declared) };
  }

  /** Alıcı ifade metninin (a, a.b, this.x, Outer.Inner, pkg.Type) tipini çözer. */
  private resolveExpr(text: string, member: JavaMember, type: JavaType, file: JavaFileModel): ExprType {
    const segs = text.split('.').map((s) => s.trim());
    if (segs.some((s) => !/^[A-Za-z_$][\w$]*$/.test(s))) return { kind: 'unknown' };
    let cur: ExprType;
    let i: number;
    if (segs[0] === 'this') {
      cur = { kind: 'type', fqn: type.fqn };
      i = 1;
    } else {
      const first = segs[0] as string;
      const local = member.localTypes[first];
      if (local !== undefined) {
        cur = this.declaredToExpr(local, file, type, member);
        i = 1;
      } else {
        const f = this.findFieldType(type, first, true);
        if (f) {
          cur = this.declaredToExpr(f.declared, f.owner.file, f.owner.type);
          i = 1;
        } else {
          // tip adı (en uzun önek)
          cur = { kind: 'unknown' };
          i = 0;
          for (let k = segs.length; k >= 1; k--) {
            const fq = this.resolveTypeName(segs.slice(0, k).join('.'), file, type);
            if (fq) {
              cur = { kind: 'type', fqn: fq };
              i = k;
              break;
            }
          }
          if (i === 0) {
            const upper = segs.findIndex((s) => /^[A-Z]/.test(s));
            if (upper >= 0) {
              // repo dışı tip adı (Collections, java.util.Objects ...)
              return { kind: 'external', raw: segs.slice(0, upper + 1).join('.') };
            }
            return { kind: 'unknown' };
          }
        }
      }
    }
    for (; i < segs.length; i++) {
      if (cur.kind !== 'type') return cur;
      const e = this.entry(cur.fqn);
      if (!e) return { kind: 'unknown' };
      const seg = segs[i] as string;
      const nested = `${cur.fqn}.${seg}`;
      if (this.typeMap.has(nested)) {
        cur = { kind: 'type', fqn: nested };
        continue;
      }
      const f = this.findFieldType(e.type, seg, false);
      if (!f) return { kind: 'unknown' };
      cur = this.declaredToExpr(f.declared, f.owner.file, f.owner.type);
    }
    return cur;
  }

  /**
   * Kendi tipi, üst tipleri, (none için) dış tipler ve statik importlar üzerinden metot adayları.
   * scope: adayların bulunduğu kapsam tipi (overload kümesi bu tipin hiyerarşisinden toplanır).
   */
  private findSelfScope(
    type: JavaType,
    file: JavaFileModel,
    name: string,
    argc: number,
    withOuter: boolean,
  ): { found: JavaMember[]; scope?: string } {
    let found = this.findInHierarchy(type.fqn, name, argc);
    if (found.length || !withOuter) return { found, scope: type.fqn };
    for (let o = this.outerOf(type); o; o = this.outerOf(o)) {
      found = this.findInHierarchy(o.fqn, name, argc);
      if (found.length) return { found, scope: o.fqn };
    }
    for (const imp of file.imports) {
      if (!imp.static) continue;
      const owner = imp.wildcard ? imp.name : simpleName(imp.name) === name ? imp.name.slice(0, imp.name.lastIndexOf('.')) : '';
      if (owner && this.typeMap.has(owner)) {
        found = this.findInHierarchy(owner, name, argc);
        if (found.length) return { found, scope: owner };
      }
    }
    return { found: [] };
  }

  private findSelfMethods(type: JavaType, file: JavaFileModel, name: string, argc: number, withOuter: boolean): JavaMember[] {
    return this.findSelfScope(type, file, name, argc, withOuter).found;
  }

  /** Ara zincir adımı: argüman sayımı yanılmış olabilir; bulunamazsa yalnız ad ile tekrar dener. */
  private findLenient(fqn: string, name: string, argc: number): JavaMember[] {
    const r = this.findInHierarchy(fqn, name, argc);
    return r.length || argc < 0 ? r : this.findInHierarchy(fqn, name, -1);
  }

  /** Aday metotların ortak dönüş tipi (generic silinmiş); farklıysa / bilinmiyorsa unknown. */
  private returnTypeOf(cands: JavaMember[]): ExprType {
    let result: ExprType | undefined;
    for (const c of cands) {
      const owner = this.memberOwner.get(c);
      if (!owner || !c.returnType) return { kind: 'unknown' };
      const et = this.declaredToExpr(c.returnType, owner.file, owner.type, c);
      if (!result) result = et;
      else if (
        et.kind !== result.kind ||
        (et.kind === 'type' && result.kind === 'type' && et.fqn !== result.fqn) ||
        (et.kind === 'external' && result.kind === 'external' && et.raw !== result.raw)
      ) {
        return { kind: 'unknown' };
      }
    }
    return result ?? { kind: 'unknown' };
  }

  /**
   * Metot çağrısı / alan erişimi zinciri olan alıcıların tipi:
   * getX(), this.repo.findAll(), order.getCustomer(), new A().b(), ((Foo) o).bar(), super.get().
   */
  private resolveChain(text: string, member: JavaMember, type: JavaType, file: JavaFileModel): ExprType {
    const chain = parseChain(text);
    if (!chain) return { kind: 'unknown' };
    const segs = chain.segs;
    if (segs.filter((x) => x.argc !== undefined).length > MAX_CHAIN_CALLS) return { kind: 'unknown' };
    let cur: ExprType;
    let i = 0;
    if (chain.head !== undefined) {
      const fq = this.resolveTypeName(chain.head, file, type);
      cur = fq ? { kind: 'type', fqn: fq } : { kind: 'external', raw: baseTypeName(chain.head) };
    } else {
      const first = segs[0];
      if (!first) return { kind: 'unknown' };
      if (first.name === 'super' && first.argc === undefined) {
        const own = this.entryByType.get(type)?.resolved ?? [];
        const sup = own.find((x) => this.entry(x)?.type.kind !== 'interface');
        if (!sup) return type.superclass ? { kind: 'external', raw: baseTypeName(type.superclass) } : { kind: 'unknown' };
        cur = { kind: 'type', fqn: sup };
        i = 1;
      } else if (first.argc !== undefined) {
        let cands = this.findSelfMethods(type, file, first.name, first.argc, true);
        if (!cands.length && first.argc >= 0) cands = this.findSelfMethods(type, file, first.name, -1, true);
        cur = this.returnTypeOf(cands);
        i = 1;
      } else {
        let k = 0;
        while (k < segs.length && segs[k]?.argc === undefined) k++;
        cur = this.resolveExpr(segs.slice(0, k).map((x) => x.name).join('.'), member, type, file);
        i = k;
      }
    }
    for (; i < segs.length; i++) {
      if (cur.kind !== 'type') return cur;
      const seg = segs[i] as ChainSeg;
      if (seg.argc !== undefined) {
        cur = this.returnTypeOf(this.findLenient(cur.fqn, seg.name, seg.argc));
        continue;
      }
      const e = this.entry(cur.fqn);
      if (!e) return { kind: 'unknown' };
      const nested = `${cur.fqn}.${seg.name}`;
      if (this.typeMap.has(nested)) {
        cur = { kind: 'type', fqn: nested };
        continue;
      }
      const f = this.findFieldType(e.type, seg.name, false);
      if (!f) return { kind: 'unknown' };
      cur = this.declaredToExpr(f.declared, f.owner.file, f.owner.type);
    }
    return cur;
  }

  private bind(rec: SiteRec, targets: string[], confidence: Confidence): void {
    const fromId = rec.member.id;
    let callees = this.calleesMap.get(fromId);
    if (!callees) {
      callees = new Set();
      this.calleesMap.set(fromId, callees);
    }
    rec.targets = rec.targets ? [...rec.targets, ...targets] : targets;
    const names = rec.site.isConstructor && rec.site.name.includes('.') ? [rec.site.name, simpleName(rec.site.name)] : [rec.site.name];
    for (const n of names) {
      const key = siteKey(fromId, rec.site.line, n);
      let set = this.siteTargets.get(key);
      if (!set) {
        set = new Set();
        this.siteTargets.set(key, set);
      }
      for (const t of targets) set.add(t);
    }
    for (const t of targets) {
      pushMap(this.callersMap, t, { fromId, file: rec.file.path, line: rec.site.line, inChangedCode: false, confidence });
      callees.add(t);
    }
  }

  private bindMembers(rec: SiteRec, cands: JavaMember[]): void {
    if (cands.length === 0) return;
    this.bind(rec, cands.map((m) => m.id), cands.length === 1 ? 'exact' : 'likely');
  }

  // ----- B8: argüman tipleriyle overload seçimi -----

  /** Argüman tipleri (çıkarılamayanlar undefined); bilgi yoksa undefined. */
  private argTypesOf(rec: SiteRec): (string | undefined)[] | undefined {
    const { site, member, type } = rec;
    if (!site.args || site.argCount < 0 || site.args.length !== site.argCount || site.argCount === 0) return undefined;
    const lookup = (name: string): string | undefined => this.findFieldType(type, name, true)?.declared;
    const types = site.args.map((a) => inferArgType(a, member, type, lookup));
    return types.some((t) => t !== undefined) ? types : undefined;
  }

  /** Bir adayın argümanlarla uyumu: fixed = sabit arity (varargs dizi olarak), variable = varargs açılımı. */
  private candidateCompat(rec: SiteRec, cand: JavaMember, argTypes: (string | undefined)[]): { fixed?: Compat; variable?: Compat } {
    const owner = this.memberOwner.get(cand);
    const paramCtx = owner ? { file: owner.file, type: owner.type } : {};
    const argCtx = { file: rec.file, type: rec.type };
    const typeVars = this.typeVarsFor(cand, owner?.type);
    const n = cand.params.length;
    const last = cand.params[n - 1];
    const one = (arg: string | undefined, param: string): Compat =>
      arg === undefined ? 'unknown' : typeCompat(this, arg, argCtx, param, paramCtx, typeVars);
    const merge = (list: Compat[]): Compat =>
      list.includes('mismatch') ? 'mismatch' : list.every((c) => c === 'ok') ? 'ok' : 'unknown';
    const erased = erasedParams(cand);
    const out: { fixed?: Compat; variable?: Compat } = {};
    if (argTypes.length === n) out.fixed = merge(argTypes.map((a, i) => one(a, erased[i] as string)));
    if (last?.varargs && argTypes.length >= n - 1) {
      const base = (erased[n - 1] as string).replace(/\[\]$/, '');
      out.variable = merge(argTypes.map((a, i) => one(a, i < n - 1 ? (erased[i] as string) : base)));
    }
    return out;
  }

  /** m1, m2'den daha özgül mü (her parametre m2'nin karşılığına atanabilir). */
  private moreSpecific(m1: JavaMember, m2: JavaMember): boolean {
    if (m1.params.length !== m2.params.length) return false;
    const o1 = this.memberOwner.get(m1);
    const o2 = this.memberOwner.get(m2);
    const tv2 = this.typeVarsFor(m2, o2?.type);
    const tv1 = this.typeVarsFor(m1, o1?.type);
    for (let i = 0; i < m1.params.length; i++) {
      const p1 = normalizeVarargs(eraseTypeForId((m1.params[i] as JavaParam).type));
      const p2 = normalizeVarargs(eraseTypeForId((m2.params[i] as JavaParam).type));
      if (p1 === p2) continue;
      if (tv1.has(p1.replace(/(\[\])+$/, ''))) return false;
      const c = typeCompat(this, p1, o1 ? { file: o1.file, type: o1.type } : {}, p2, o2 ? { file: o2.file, type: o2.type } : {}, tv2);
      if (c !== 'ok') return false;
    }
    return true;
  }

  /**
   * Overload seçimi: `first` arity ile seçilmiş eski sonuç (geri düşüş), `all` hiyerarşideki tüm ad/arity uyumlu adaylar.
   * Uyumlu tek aday: argüman tipleri hepsi doğrulandıysa exact, değilse likely. Hiçbir şey elenmiyorsa eski davranış.
   */
  private bindOverloads(rec: SiteRec, first: JavaMember[], all: () => JavaMember[]): void {
    if (first.length === 0) return;
    const pick = this.selectOverload(rec, first, all);
    if (!pick) {
      this.bindMembers(rec, first);
      return;
    }
    this.bind(rec, pick.members.map((m) => m.id), pick.confidence);
  }

  private selectOverload(
    rec: SiteRec,
    first: JavaMember[],
    allFn: () => JavaMember[],
  ): { members: JavaMember[]; confidence: Confidence } | undefined {
    const argTypes = this.argTypesOf(rec);
    if (!argTypes) return undefined;
    const all = allFn();
    if (all.length <= 1) return undefined;
    const evals = all.map((m) => ({ m, c: this.candidateCompat(rec, m, argTypes) }));
    // JLS 15.12.2: önce sabit arity (faz 1/2), yoksa değişken arity (faz 3)
    let phase = evals.filter((e) => e.c.fixed !== undefined && e.c.fixed !== 'mismatch').map((e) => ({ m: e.m, s: e.c.fixed as Compat }));
    if (phase.length === 0) {
      phase = evals.filter((e) => e.c.variable !== undefined && e.c.variable !== 'mismatch').map((e) => ({ m: e.m, s: e.c.variable as Compat }));
    }
    if (phase.length === 0) {
      rec.typeConflict = true;
      return undefined;
    }
    if (phase.length === 1) {
      const only = phase[0] as { m: JavaMember; s: Compat };
      return { members: [only.m], confidence: only.s === 'ok' ? 'exact' : 'likely' };
    }
    if (phase.every((x) => x.s === 'ok')) {
      // tüm uyumlu adaylar doğrulandı: en özgül tek aday (JLS 15.12.2.5)
      const ms = phase.filter((x) => phase.every((y) => y === x || this.moreSpecific(x.m, y.m)));
      if (ms.length === 1) return { members: [(ms[0] as { m: JavaMember }).m], confidence: 'exact' };
    }
    if (phase.length === all.length && all.length === first.length) return undefined; // hiçbir şey elenmedi
    // birden çok uyumlu aday: eski (arity) seçimin bir alt kümesiyse onu daralt
    const firstSet = new Set(first);
    const narrowed = phase.filter((x) => firstSet.has(x.m)).map((x) => x.m);
    const members = narrowed.length ? narrowed : phase.map((x) => x.m);
    if (members.length === first.length && narrowed.length === first.length) return undefined;
    return { members, confidence: 'likely' };
  }

  private bindConstructor(rec: SiteRec, fqn: string): void {
    const e = this.entry(fqn);
    if (!e) return;
    if (e.ctors.length === 0) {
      this.bind(rec, [fqn], 'exact');
      return;
    }
    const compatible = e.ctors.filter((c) => argCompatible(c, rec.site.argCount));
    const ok = preferExact(compatible, rec.site.argCount);
    if (ok.length) this.bindOverloads(rec, ok, () => compatible);
    else this.bind(rec, [fqn], 'likely');
  }

  private bindNameOnly(rec: SiteRec): void {
    let all = (this.methodsByName.get(rec.site.name) ?? []).filter(
      (r) => argCompatible(r.member, rec.site.argCount) && (r.member.visibility !== 'private' || r.file === rec.file),
    );
    if (all.length > 1) {
      const argTypes = this.argTypesOf(rec);
      if (argTypes) {
        const kept = all.filter((r) => {
          const c = this.candidateCompat(rec, r.member, argTypes);
          return (c.fixed !== undefined && c.fixed !== 'mismatch') || (c.variable !== undefined && c.variable !== 'mismatch');
        });
        if (kept.length > 0) all = kept;
      }
    }
    if (all.length === 0 || all.length > MAX_NAME_ONLY) return;
    this.bind(rec, all.map((r) => r.member.id), all.length === 1 ? 'likely' : 'name-only');
  }

  private resolveSite(rec: SiteRec): void {
    const { site, member, type, file } = rec;
    // --- yapıcılar ---
    if (site.isConstructor) {
      let fqn: string | undefined;
      if (!site.isMethodRef && site.receiverKind === 'this' && site.receiver === 'this') fqn = type.fqn;
      else if (!site.isMethodRef && site.receiverKind === 'super' && site.receiver === 'super') {
        fqn = rec.entry.resolved.find((s) => this.entry(s)?.type.kind !== 'interface');
        if (!fqn && type.superclass) rec.recvRaw = baseTypeName(type.superclass);
      } else {
        fqn = this.resolveTypeName(site.name, file, type);
        if (!fqn) rec.recvRaw = baseTypeName(site.name);
      }
      if (fqn) {
        rec.state = 'resolved';
        rec.recvType = fqn;
        this.bindConstructor(rec, fqn);
      } else rec.state = 'external';
      return;
    }
    // --- metotlar ---
    const name = site.name;
    const argc = site.argCount;
    switch (site.receiverKind) {
      case 'none':
      case 'this': {
        rec.state = 'self';
        const { found, scope } = this.findSelfScope(type, file, name, argc, site.receiverKind === 'none');
        if (found.length && scope) this.bindOverloads(rec, found, () => this.overloadsInHierarchy(scope, name, argc));
        return;
      }
      case 'super': {
        const recv = site.receiver ?? 'super';
        let start: string[] = [];
        if (recv === 'super') {
          start = rec.entry.resolved.filter((s) => this.entry(s)?.type.kind !== 'interface');
          if (!start.length) start = rec.entry.resolved;
        } else {
          const q = this.resolveTypeName(recv.replace(/\.super$/, ''), file, type);
          if (q) start = [q];
        }
        if (!start.length) {
          rec.state = 'external';
          if (type.superclass) rec.recvRaw = baseTypeName(type.superclass);
          return;
        }
        rec.state = 'resolved';
        rec.recvType = start[0] as string;
        for (const s of start) {
          const found = this.findInHierarchy(s, name, argc);
          if (found.length) {
            this.bindOverloads(rec, found, () => this.overloadsInHierarchy(s, name, argc));
            return;
          }
        }
        return;
      }
      case 'identifier':
      case 'field-access':
      case 'expression': {
        let et: ExprType = { kind: 'unknown' };
        const recv = site.receiver ?? '';
        if (site.receiverKind !== 'expression') et = this.resolveExpr(recv, member, type, file);
        else et = this.resolveChain(recv, member, type, file);
        if (et.kind === 'type') {
          rec.state = 'resolved';
          rec.recvType = et.fqn;
          const found = this.findInHierarchy(et.fqn, name, argc);
          if (found.length) this.bindOverloads(rec, found, () => this.overloadsInHierarchy(et.fqn, name, argc));
        } else if (et.kind === 'external') {
          rec.state = 'external';
          rec.recvRaw = et.raw;
        } else {
          rec.state = 'unknown';
          this.bindNameOnly(rec);
        }
        return;
      }
      default:
        rec.state = 'unknown';
    }
  }

  private resolveAllCalls(): void {
    for (const entry of this.entries) {
      const { type, file } = entry;
      this.withRoot(entry.root, () => {
        for (const member of type.members) {
          for (const site of member.callSites) {
            const rec: SiteRec = { site, member, type, file, entry, state: 'unknown' };
            try {
              this.resolveSite(rec);
            } catch {
              rec.state = 'unknown';
            }
            const key = site.isConstructor ? simpleName(site.name) : site.name;
            pushMap(this.sitesByName, key, rec);
          }
        }
      });
    }
  }

  callersOf(memberId: string): CallRef[] {
    return (this.callersMap.get(memberId) ?? []).map((c) => ({ ...c }));
  }

  calleesOf(memberId: string): string[] {
    return [...(this.calleesMap.get(memberId) ?? [])];
  }

  /**
   * Çağrı yerinin build sırasında bağlandığı hedef id'ler (aynı satırda aynı adlı birden çok çağrı varsa birleşimi).
   * Yapıcı çağrılarında name = tip basit adı; yapıcısız tipte hedef tip FQN'idir. Bağlanmamışsa [].
   */
  targetsOfCallSite(fromId: string, line: number, name: string): string[] {
    return [...(this.siteTargets.get(siteKey(fromId, line, name)) ?? [])];
  }

  // -------------------------------------------------------------------------
  // Silinmiş semboller için çağrı arama
  // -------------------------------------------------------------------------

  private packageOfFqn(fqn: string): string {
    const e = this.typeMap.get(fqn);
    if (e) return e.file.packageName;
    const idx = fqn.lastIndexOf('.');
    return idx >= 0 ? fqn.slice(0, idx) : '';
  }

  private ownerOfId(id: string): string {
    const h = id.indexOf('#');
    return h >= 0 ? id.slice(0, h) : id;
  }

  findCallsTo(ownerFqn: string, name: string, argCount?: number): CallRef[] {
    const ownerSimple = simpleName(ownerFqn);
    const related = new Set<string>([ownerFqn]);
    const addWithSubs = (f: string): void => {
      related.add(f);
      for (const s of this.subTypesOf(f, true)) related.add(s);
    };
    addWithSubs(ownerFqn);
    for (const s of this.superTypesTransitive(ownerFqn)) related.add(s);
    // sahip tip indekste yoksa (silinmiş): çözülemeyen üst tip adı eşleşen tipler
    for (const e of this.entries) {
      if (e.supers.some((s) => !this.typeMap.has(s) && (s === ownerFqn || simpleName(s) === ownerSimple))) addWithSubs(e.type.fqn);
    }
    const ownerPkg = this.packageOfFqn(ownerFqn);
    const isCtor = name === ownerSimple;
    const out: CallRef[] = [];
    const push = (rec: SiteRec, confidence: Confidence): void => {
      out.push({ fromId: rec.member.id, file: rec.file.path, line: rec.site.line, inChangedCode: false, confidence });
    };
    const importsOwner = (file: JavaFileModel): boolean =>
      file.packageName === ownerPkg ||
      file.imports.some((i) => (!i.wildcard && i.name === ownerFqn) || (i.wildcard && i.name === ownerPkg));
    /**
     * B1(d): alıcısız/this çağrısı, çağıranın kendi tipinde ya da dış tipinde bildirilmiş aynı adlı bir üyeye
     * bağlandıysa (ör. iç sınıf aynı metodu tanımlıyor) sahibin üyesine gitmez. Argüman tipi çelişkisi varsa atlanmaz.
     */
    const boundElsewhere = (rec: SiteRec): boolean => {
      if (!rec.targets?.length || rec.typeConflict) return false;
      const lexical = new Set<string>();
      for (let t: JavaType | undefined = rec.type; t; t = this.outerOf(t)) lexical.add(t.fqn);
      return rec.targets.every((id) => {
        const o = this.ownerOfId(id);
        return o !== ownerFqn && lexical.has(o);
      });
    };
    for (const rec of this.sitesByName.get(name) ?? []) {
      const s = rec.site;
      if (s.isConstructor !== isCtor) continue;
      if (argCount !== undefined && s.argCount >= 0 && s.argCount !== argCount) continue;
      if (isCtor) {
        if (rec.recvType && related.has(rec.recvType)) push(rec, 'exact');
        else if (!rec.recvType && rec.recvRaw && simpleName(rec.recvRaw) === ownerSimple) {
          push(rec, importsOwner(rec.file) ? 'exact' : 'likely');
        }
        continue;
      }
      switch (rec.state) {
        case 'self': {
          if (boundElsewhere(rec)) break;
          let inRelated = false;
          for (let t: JavaType | undefined = rec.type; t; t = this.outerOf(t)) {
            if (related.has(t.fqn)) inRelated = true;
          }
          const staticImport = rec.file.imports.some(
            (i) => i.static && (i.name === `${ownerFqn}.${name}` || (i.wildcard && i.name === ownerFqn)),
          );
          if (s.receiverKind === 'none' && !rec.targets?.length && !staticImport) {
            // B1(d): sınıf kapsamında bulunamayan ad, başka bir tipten statik import edilmişse oraya gider
            const single = rec.file.imports.some((i) => i.static && !i.wildcard && simpleName(i.name) === name);
            if (single) break;
            const wild = rec.file.imports.filter((i) => i.static && i.wildcard && i.name !== ownerFqn);
            const repoWild = wild.some((i) => this.findInHierarchy(i.name, name, s.argCount).length > 0);
            if (repoWild) break;
            if (inRelated) {
              push(rec, wild.some((i) => !this.typeMap.has(i.name)) ? 'likely' : 'exact');
              break;
            }
          }
          if (inRelated || (s.receiverKind === 'none' && staticImport)) push(rec, 'exact');
          break;
        }
        case 'resolved':
          if (rec.recvType && related.has(rec.recvType)) push(rec, 'exact');
          break;
        case 'external':
          if (rec.recvRaw && (rec.recvRaw === ownerFqn || simpleName(rec.recvRaw) === ownerSimple)) {
            push(rec, importsOwner(rec.file) ? 'exact' : 'likely');
          }
          break;
        default:
          push(rec, 'name-only');
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Tip referansları
  // -------------------------------------------------------------------------

  filesReferencingType(fqn: string): string[] {
    const entry = this.typeMap.get(fqn);
    const simple = simpleName(fqn);
    let top = entry?.type;
    while (top?.outerFqn) {
      const o = this.outerOf(top);
      if (!o) break;
      top = o;
    }
    const topFqn = top?.fqn ?? fqn;
    const pkg = entry ? entry.file.packageName : this.packageOfFqn(fqn);
    const declaring = new Set((this.typeCands.get(fqn) ?? []).map((e) => e.file.path));
    const out = new Set<string>();
    // doğrudan import (iç tip için dış tipin importu tek başına yetmez; basit ad kullanımı aşağıda kontrol edilir)
    for (const p of this.filesByImport.get(fqn) ?? []) out.add(p);
    const containers = new Set([pkg, topFqn, entry?.type.outerFqn].filter((x): x is string => x !== undefined));
    for (const p of this.filesBySimpleRef.get(simple) ?? []) {
      const f = this.files.get(p);
      if (!f) continue;
      // aynı basit adlı başka bir tipi tekil import eden dosya bu tipe başvurmaz (gölgeleme)
      const shadowed = f.imports.some((i) => !i.wildcard && !i.static && simpleName(i.name) === simple && i.name !== fqn);
      if (shadowed) continue;
      if (f.packageName === pkg || f.imports.some((i) => i.wildcard && containers.has(i.name))) out.add(p);
      else if (f.imports.some((i) => !i.wildcard && (i.name === fqn || i.name === topFqn))) out.add(p);
    }
    for (const d of declaring) out.delete(d);
    return [...out].sort();
  }
}

/**
 * Repo geneli Java sembol indeksi: tip çözümleme, kalıtım, override ilişkileri ve çağrı grafiği.
 */
import type { CallRef } from '../../shared/types.js';
import type { CallSite, JavaFileModel, JavaMember, JavaType, RepoIndexApi, ResolvedMember } from './model.js';
import {
  baseTypeName,
  eraseTypeForId,
  normalizeVarargs,
  referencedSimpleNames,
  simpleName,
  typeParamNames,
} from './names.js';

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
  typeVars: Set<string>;
  methodsByName: Map<string, JavaMember[]>;
  ctors: JavaMember[];
}

type RecvState = 'self' | 'resolved' | 'external' | 'unknown';

interface SiteRec {
  site: CallSite;
  member: JavaMember;
  type: JavaType;
  file: JavaFileModel;
  state: RecvState;
  recvType?: string; // çözülen alıcı tip FQN
  recvRaw?: string; // çözülemeyen (repo dışı/silinmiş) alıcı tip adı
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

export class RepoIndex implements RepoIndexApi {
  readonly files: ReadonlyMap<string, JavaFileModel>;
  private readonly typeMap = new Map<string, TypeEntry>();
  private readonly memberMap = new Map<string, ResolvedMember>();
  private readonly superMap = new Map<string, string[]>();
  private readonly resolvedSupers = new Map<string, string[]>();
  private readonly subMap = new Map<string, string[]>();
  private readonly methodsByName = new Map<string, ResolvedMember[]>();
  private readonly callersMap = new Map<string, CallRef[]>();
  private readonly calleesMap = new Map<string, Set<string>>();
  private readonly sitesByName = new Map<string, SiteRec[]>();
  private readonly filesBySimpleRef = new Map<string, Set<string>>();
  private readonly filesByImport = new Map<string, Set<string>>();
  private readonly resolveCache = new WeakMap<JavaFileModel, Map<string, string | undefined>>();
  private supersReady = false;

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
    idx.resolveAllCalls();
    return idx;
  }

  // -------------------------------------------------------------------------
  // Kurulum
  // -------------------------------------------------------------------------

  private registerAll(): void {
    for (const file of this.files.values()) {
      for (const type of file.types) {
        const entry: TypeEntry = {
          type,
          file,
          typeVars: new Set(typeParamNames(type.typeParams)),
          methodsByName: new Map(),
          ctors: [],
        };
        if (this.typeMap.has(type.fqn)) continue; // yinelenen FQN: ilk kazanır
        this.typeMap.set(type.fqn, entry);
        for (const m of type.members) {
          const rm: ResolvedMember = { member: m, type, file };
          if (!this.memberMap.has(m.id)) this.memberMap.set(m.id, rm);
          if (m.kind === 'method') {
            pushMap(entry.methodsByName, m.name, m);
            pushMap(this.methodsByName, m.name, rm);
          } else if (m.kind === 'constructor') entry.ctors.push(m);
        }
      }
    }
  }

  private computeSupers(): void {
    for (const [fqn, entry] of this.typeMap) {
      const t = entry.type;
      const raws = [...(t.superclass ? [t.superclass] : []), ...t.interfaces];
      const out: string[] = [];
      const resolved: string[] = [];
      for (const raw of raws) {
        const r = this.resolveTypeName(raw, entry.file, t);
        if (r && r !== fqn) {
          out.push(r);
          resolved.push(r);
          pushMap(this.subMap, r, fqn);
        } else out.push(raw);
      }
      this.superMap.set(fqn, out);
      this.resolvedSupers.set(fqn, resolved);
    }
    this.supersReady = true;
  }

  private indexReferences(): void {
    for (const file of this.files.values()) {
      const names = new Set<string>();
      const add = (text: string | undefined): void => {
        if (!text) return;
        for (const n of referencedSimpleNames(text)) names.add(n);
      };
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

  // -------------------------------------------------------------------------
  // Tip çözümleme
  // -------------------------------------------------------------------------

  private outerOf(t: JavaType): JavaType | undefined {
    return t.outerFqn ? this.typeMap.get(t.outerFqn)?.type : undefined;
  }

  private isTypeVar(name: string, fromType: JavaType | undefined, member?: JavaMember): boolean {
    const n = baseTypeName(name);
    if (member && typeParamNames(member.typeParams).includes(n)) return true;
    for (let t = fromType; t; t = this.outerOf(t)) {
      const e = this.typeMap.get(t.fqn);
      if (e ? e.typeVars.has(n) : typeParamNames(t.typeParams).includes(n)) return true;
      // statik iç tip (ve örtük statik enum/record/interface) dış tipin tip değişkenlerini görmez
      if (t.modifiers.includes('static') || t.kind !== 'class') break;
    }
    return false;
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
    const queue = [...(this.resolvedSupers.get(fqn) ?? [])];
    while (queue.length) {
      const s = queue.shift() as string;
      if (seen.has(s)) continue;
      seen.add(s);
      const cand = `${s}.${name}`;
      if (this.typeMap.has(cand)) return cand;
      queue.push(...(this.resolvedSupers.get(s) ?? []));
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
    let result: string | undefined;
    if (clean.includes('.')) {
      if (this.typeMap.has(clean)) result = clean;
      else {
        const segs = clean.split('.');
        const head = this.resolveSimple(segs[0] as string, fromFile, fromType);
        if (head) {
          const cand = [head, ...segs.slice(1)].join('.');
          if (this.typeMap.has(cand)) result = cand;
        }
      }
    } else result = this.resolveSimple(clean, fromFile, fromType);
    cache.set(key, result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Basit sorgular
  // -------------------------------------------------------------------------

  getType(fqn: string): JavaType | undefined {
    return this.typeMap.get(fqn)?.type;
  }

  getFileOfType(fqn: string): JavaFileModel | undefined {
    return this.typeMap.get(fqn)?.file;
  }

  getMember(id: string): ResolvedMember | undefined {
    return this.memberMap.get(id);
  }

  superTypesOf(fqn: string): string[] {
    return [...(this.superMap.get(fqn) ?? [])];
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
    const queue = [...(this.resolvedSupers.get(fqn) ?? [])];
    while (queue.length) {
      const s = queue.shift() as string;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      queue.push(...(this.resolvedSupers.get(s) ?? []));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Override ilişkileri
  // -------------------------------------------------------------------------

  private paramsCompatible(a: JavaMember, at: JavaType, b: JavaMember, bt: JavaType): boolean {
    if (a.params.length !== b.params.length) return false;
    for (let i = 0; i < a.params.length; i++) {
      const pa = normalizeVarargs(eraseTypeForId((a.params[i] as { type: string }).type));
      const pb = normalizeVarargs(eraseTypeForId((b.params[i] as { type: string }).type));
      if (pa === pb) continue;
      const ba = pa.replace(/\[\]/g, '');
      const bb = pb.replace(/\[\]/g, '');
      if (this.isTypeVar(ba, at, a) || this.isTypeVar(bb, bt, b)) continue;
      return false;
    }
    return true;
  }

  private overrideMatches(m: JavaMember, mt: JavaType, otherFqn: string): string[] {
    const e = this.typeMap.get(otherFqn);
    if (!e) return [];
    const out: string[] = [];
    for (const cand of e.methodsByName.get(m.name) ?? []) {
      if (isStaticOrPrivate(cand)) continue;
      if (this.paramsCompatible(m, mt, cand, e.type)) out.push(cand.id);
    }
    return out;
  }

  /** Somut (abstract olmayan, gövdeli) uyumlu metot id'leri. */
  private concreteMatches(m: JavaMember, mt: JavaType, otherFqn: string): string[] {
    return this.overrideMatches(m, mt, otherFqn).filter((id) => {
      const c = this.memberMap.get(id)?.member;
      return !!c && !c.modifiers.includes('abstract') && c.normalizedBody !== '';
    });
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
      queue.push(...(this.resolvedSupers.get(t) ?? []));
    }
    return false;
  }

  overridesOf(memberId: string): string[] {
    const rm = this.memberMap.get(memberId);
    if (!rm || rm.member.kind !== 'method' || isStaticOrPrivate(rm.member)) return [];
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
  }

  overriddenBy(memberId: string): string[] {
    const rm = this.memberMap.get(memberId);
    if (!rm || rm.member.kind !== 'method' || isStaticOrPrivate(rm.member)) return [];
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
    return [...out];
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
        const e = this.typeMap.get(t);
        if (!e) continue;
        for (const m of e.methodsByName.get(name) ?? []) if (argCompatible(m, argCount)) found.push(m);
        next.push(...(this.resolvedSupers.get(t) ?? []));
      }
      if (found.length) return preferExact(found, argCount);
      level = next;
    }
    return [];
  }

  /** Alanın bildirilen tipi (tip, üst tipleri ve dış tipleri boyunca). */
  private findFieldType(fromType: JavaType, field: string, withOuter: boolean): { declared: string; owner: TypeEntry } | undefined {
    const visit = (fqn: string): { declared: string; owner: TypeEntry } | undefined => {
      const e = this.typeMap.get(fqn);
      if (e) {
        const d = e.type.fieldTypes[field];
        if (d !== undefined) return { declared: d, owner: e };
      }
      for (const s of this.superTypesTransitive(fqn)) {
        const se = this.typeMap.get(s);
        const d = se?.type.fieldTypes[field];
        if (se && d !== undefined) return { declared: d, owner: se };
      }
      return undefined;
    };
    for (let t: JavaType | undefined = fromType; t; t = withOuter ? this.outerOf(t) : undefined) {
      const r = visit(t.fqn);
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
      const e = this.typeMap.get(cur.fqn);
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

  /** Kendi tipi, üst tipleri, (none için) dış tipler ve statik importlar üzerinden metot adayları. */
  private findSelfMethods(type: JavaType, file: JavaFileModel, name: string, argc: number, withOuter: boolean): JavaMember[] {
    let found = this.findInHierarchy(type.fqn, name, argc);
    if (found.length || !withOuter) return found;
    for (let o = this.outerOf(type); o && !found.length; o = this.outerOf(o)) found = this.findInHierarchy(o.fqn, name, argc);
    if (found.length) return found;
    for (const imp of file.imports) {
      if (!imp.static) continue;
      const owner = imp.wildcard ? imp.name : simpleName(imp.name) === name ? imp.name.slice(0, imp.name.lastIndexOf('.')) : '';
      if (owner && this.typeMap.has(owner)) {
        found = this.findInHierarchy(owner, name, argc);
        if (found.length) return found;
      }
    }
    return [];
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
      const rm = this.memberMap.get(c.id);
      if (!rm || !c.returnType) return { kind: 'unknown' };
      const et = this.declaredToExpr(c.returnType, rm.file, rm.type, c);
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
        const sup = (this.resolvedSupers.get(type.fqn) ?? []).find((x) => this.typeMap.get(x)?.type.kind !== 'interface');
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
      const e = this.typeMap.get(cur.fqn);
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
    for (const t of targets) {
      pushMap(this.callersMap, t, { fromId, file: rec.file.path, line: rec.site.line, inChangedCode: false, confidence });
      callees.add(t);
    }
  }

  private bindMembers(rec: SiteRec, cands: JavaMember[]): void {
    if (cands.length === 0) return;
    this.bind(rec, cands.map((m) => m.id), cands.length === 1 ? 'exact' : 'likely');
  }

  private bindConstructor(rec: SiteRec, fqn: string): void {
    const e = this.typeMap.get(fqn);
    if (!e) return;
    if (e.ctors.length === 0) {
      this.bind(rec, [fqn], 'exact');
      return;
    }
    const ok = preferExact(e.ctors.filter((c) => argCompatible(c, rec.site.argCount)), rec.site.argCount);
    if (ok.length) this.bindMembers(rec, ok);
    else this.bind(rec, [fqn], 'likely');
  }

  private bindNameOnly(rec: SiteRec): void {
    const all = (this.methodsByName.get(rec.site.name) ?? []).filter(
      (r) => argCompatible(r.member, rec.site.argCount) && (r.member.visibility !== 'private' || r.file === rec.file),
    );
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
        fqn = (this.resolvedSupers.get(type.fqn) ?? []).find((s) => this.typeMap.get(s)?.type.kind !== 'interface');
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
        const found = this.findSelfMethods(type, file, name, argc, site.receiverKind === 'none');
        this.bindMembers(rec, found);
        return;
      }
      case 'super': {
        const recv = site.receiver ?? 'super';
        let start: string[] = [];
        if (recv === 'super') {
          start = (this.resolvedSupers.get(type.fqn) ?? []).filter((s) => this.typeMap.get(s)?.type.kind !== 'interface');
          if (!start.length) start = this.resolvedSupers.get(type.fqn) ?? [];
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
            this.bindMembers(rec, found);
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
          this.bindMembers(rec, this.findInHierarchy(et.fqn, name, argc));
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
    for (const file of this.files.values()) {
      for (const type of file.types) {
        if (this.typeMap.get(type.fqn)?.type !== type) continue;
        for (const member of type.members) {
          for (const site of member.callSites) {
            const rec: SiteRec = { site, member, type, file, state: 'unknown' };
            try {
              this.resolveSite(rec);
            } catch {
              rec.state = 'unknown';
            }
            const key = site.isConstructor ? simpleName(site.name) : site.name;
            pushMap(this.sitesByName, key, rec);
          }
        }
      }
    }
  }

  callersOf(memberId: string): CallRef[] {
    return (this.callersMap.get(memberId) ?? []).map((c) => ({ ...c }));
  }

  calleesOf(memberId: string): string[] {
    return [...(this.calleesMap.get(memberId) ?? [])];
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
    for (const [fqn, supers] of this.superMap) {
      if (supers.some((s) => !this.typeMap.has(s) && (s === ownerFqn || simpleName(s) === ownerSimple))) addWithSubs(fqn);
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
          let inRelated = false;
          for (let t: JavaType | undefined = rec.type; t; t = this.outerOf(t)) {
            if (related.has(t.fqn)) inRelated = true;
          }
          const staticImport = rec.file.imports.some(
            (i) => i.static && (i.name === `${ownerFqn}.${name}` || (i.wildcard && i.name === ownerFqn)),
          );
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
      const o = this.typeMap.get(top.outerFqn)?.type;
      if (!o) break;
      top = o;
    }
    const topFqn = top?.fqn ?? fqn;
    const pkg = entry ? entry.file.packageName : this.packageOfFqn(fqn);
    const declaring = entry?.file.path;
    const out = new Set<string>();
    // doğrudan import (iç tip için dış tipin importu tek başına yetmez; basit ad kullanımı aşağıda kontrol edilir)
    for (const p of this.filesByImport.get(fqn) ?? []) out.add(p);
    const containers = new Set([pkg, topFqn, entry?.type.outerFqn].filter((x): x is string => x !== undefined));
    for (const p of this.filesBySimpleRef.get(simple) ?? []) {
      const f = this.files.get(p);
      if (!f) continue;
      if (f.packageName === pkg || f.imports.some((i) => i.wildcard && containers.has(i.name))) out.add(p);
      else if (f.imports.some((i) => !i.wildcard && (i.name === fqn || i.name === topFqn))) out.add(p);
    }
    if (declaring) out.delete(declaring);
    return [...out].sort();
  }
}

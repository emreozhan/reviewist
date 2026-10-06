/**
 * Kod gezinme: dosya özeti (FileOutline: bildirimler + tıklanabilir referanslar) ve sembol konumu (SymbolLocation).
 *
 * Girdi: ReviewModel + review'un analiz artefaktları (buildReview `onArtifacts` ya da `buildArtifacts`).
 * Dönen tüm id'ler ReviewModel biçimindedir (çift FQN'de '@kök' soneki dahil). Artefakt modelleri ayrıştırma önbelleğiyle
 * paylaşılır; burada DEĞİŞTİRİLMEZ.
 *
 * Model seçimi (outline):
 *  - new: değişen dosyada head modeli (indeksle aynı nesne → çağrı hedefleri doğrudan), değilse indeksteki model.
 *  - old: değişen dosyada base modeli; çağrı hedefleri için satır diff hunk'larıyla head satırına eşlenir (yalnız değişmeyen
 *    bağlam satırlarında; silinen satırlarda hedef boş). Değişmeyen dosyada eski içerik = head, indeks modeli kullanılır.
 *  - Artefaktlarda olmayan Java dosyası (indeks sınırı, analiz edilemeyen dosya): kaynaktan okunup ayrıştırılır;
 *    tip referansları çözülür, çağrı hedefleri boş kalır.
 */
import type {
  ChangeSet,
  ChangeStatus,
  FileChange,
  FileOutline,
  Range,
  ReviewModel,
  SymbolDecl,
  SymbolKind,
  SymbolLocation,
  SymbolRef,
} from '../shared/types.js';
import type { ReviewArtifacts } from './buildReview.js';
import { parseJavaFiles } from './java/index.js';
import type { JavaFileModel, JavaMember, JavaType } from './java/model.js';
import { typeParamNames } from './java/names.js';
import { decodeTypeRefPositions } from './java/typeRefTable.js';
import { rootOfModelId, sourceRootFor, stripRootSuffix } from './analysis/symbolIds.js';

/** Paket önekli olmadan kullanılabilen JDK tipleri (java.lang); çözülemezlerse referans olarak döndürülmez (gürültü). */
const JAVA_LANG = new Set([
  'Object', 'String', 'Integer', 'Long', 'Short', 'Byte', 'Double', 'Float', 'Boolean', 'Character', 'Number', 'Math',
  'StrictMath', 'System', 'Thread', 'Runnable', 'Exception', 'RuntimeException', 'Error', 'Throwable', 'Iterable',
  'IllegalArgumentException', 'IllegalStateException', 'NullPointerException', 'UnsupportedOperationException',
  'IndexOutOfBoundsException', 'ArrayIndexOutOfBoundsException', 'StringIndexOutOfBoundsException', 'ClassCastException',
  'ArithmeticException', 'InterruptedException', 'CloneNotSupportedException', 'NumberFormatException',
  'SecurityException', 'ReflectiveOperationException', 'ClassNotFoundException', 'NoSuchMethodException',
  'NoSuchFieldException', 'IllegalAccessException', 'InstantiationException', 'NegativeArraySizeException',
  'ArrayStoreException', 'AssertionError', 'OutOfMemoryError', 'StackOverflowError', 'LinkageError',
  'ExceptionInInitializerError', 'VirtualMachineError', 'InternalError', 'Comparable', 'CharSequence', 'StringBuilder',
  'StringBuffer', 'Class', 'ClassLoader', 'Enum', 'Record', 'Void', 'Override', 'Deprecated', 'SuppressWarnings',
  'FunctionalInterface', 'SafeVarargs', 'AutoCloseable', 'Cloneable', 'Appendable', 'Readable', 'Process',
  'ProcessBuilder', 'Runtime', 'ThreadLocal', 'InheritableThreadLocal', 'ThreadGroup', 'Package', 'Module',
  'StackTraceElement', 'StackWalker', 'SecurityManager', 'Compiler', 'ScopedValue', 'StringTemplate', 'MatchException',
]);

/** Ayrıştırılan (artefakt dışı) dosya önbelleği boyutu (navigator başına). */
const EXTRA_MODEL_CACHE = 32;

type Side = 'old' | 'new';

interface Located {
  kind: SymbolKind;
  name: string;
  signature?: string;
  path: string;
  side: Side;
  range: Range;
  typeId: string;
}

/** Tip için okunur imza: 'public abstract class Foo<T> extends Bar implements Baz, Qux'. */
export function typeSignature(t: JavaType): string {
  const parts: string[] = [];
  if (t.modifiers.length) parts.push(t.modifiers.join(' '));
  parts.push(t.kind === 'annotation' ? '@interface' : t.kind);
  parts.push(`${t.name}${t.typeParams ?? ''}`);
  if (t.superclass) parts.push(`extends ${t.superclass}`);
  if (t.interfaces.length) parts.push(`${t.kind === 'interface' ? 'extends' : 'implements'} ${t.interfaces.join(', ')}`);
  return parts.join(' ');
}

function ownerOf(id: string): { owner: string; rest: string } {
  const i = id.indexOf('#');
  return i < 0 ? { owner: id, rest: '' } : { owner: id.slice(0, i), rest: id.slice(i) };
}

const ANON_RE = /^(.+?)\$anon(\d+)#([^#(]+)\(/;

/** Diff hunk'larıyla eski satır → yeni satır (silinen satırda undefined). */
export function oldToNewLineMapper(fc: FileChange): (oldLine: number) => number | undefined {
  const exact = new Map<number, number | undefined>();
  const after: { lastOld: number; delta: number }[] = [];
  for (const h of fc.hunks) {
    let lastOld = -1;
    let lastNew = -1;
    for (const l of h.lines) {
      if (l.oldNo !== undefined) {
        exact.set(l.oldNo, l.type === 'context' ? l.newNo : undefined);
        lastOld = Math.max(lastOld, l.oldNo);
      }
      if (l.newNo !== undefined) lastNew = Math.max(lastNew, l.newNo);
    }
    if (lastOld < 0) lastOld = h.oldStart + h.oldLines - 1;
    if (lastNew < 0) lastNew = h.newStart + h.newLines - 1;
    after.push({ lastOld, delta: lastNew - lastOld });
  }
  after.sort((a, b) => a.lastOld - b.lastOld);
  return (oldLine) => {
    if (exact.has(oldLine)) return exact.get(oldLine);
    let delta = 0;
    for (const a of after) {
      if (a.lastOld < oldLine) delta = a.delta;
      else break;
    }
    return oldLine + delta;
  };
}

/** Bir ReviewModel + artefaktlar üzerinde kod gezinme sorguları. Sunucu review başına bir örnek tutar. */
export class ReviewNavigator {
  private readonly changedNew = new Map<string, FileChange>();
  private readonly changedOld = new Map<string, FileChange>();
  private readonly statusNew = new Map<string, ChangeStatus>();
  private readonly statusOld = new Map<string, ChangeStatus>();
  private readonly modelTypeIds = new Set<string>();
  private readonly extraModels = new Map<string, Promise<JavaFileModel | undefined>>();
  private readonly lineMappers = new Map<string, (l: number) => number | undefined>();
  private repoPackages: Set<string> | undefined;
  private changedSymbols: { newMap: Map<string, Located>; oldMap: Map<string, Located> } | undefined;

  constructor(
    readonly model: ReviewModel,
    readonly artifacts: ReviewArtifacts,
  ) {
    for (const f of model.files) {
      if (f.status !== 'deleted') this.changedNew.set(f.path, f);
      if (f.status !== 'added') this.changedOld.set(f.oldPath ?? f.path, f);
    }
    for (const t of model.types) {
      this.modelTypeIds.add(t.id);
      this.noteStatus(t.id, t.oldId, t.status);
      for (const m of t.members) this.noteStatus(m.id, m.oldId, m.status);
    }
  }

  private noteStatus(id: string, oldId: string | undefined, status: ChangeStatus): void {
    if (status === 'unchanged') return;
    if (status !== 'removed') this.statusNew.set(id, status);
    if (status !== 'added') this.statusOld.set(oldId ?? id, status);
  }

  /** İndeks id'sini (soneksiz) dosya bağlamında ReviewModel id'sine çevirir. */
  private modelId(indexId: string, path: string, pkg: string): string {
    const { owner, rest } = ownerOf(indexId);
    if (!this.artifacts.ids.collided.has(owner)) return indexId;
    const suffixed = `${owner}@${sourceRootFor(path, pkg)}`;
    return this.modelTypeIds.has(suffixed) ? `${suffixed}${rest}` : indexId;
  }

  // -------------------------------------------------------------------------
  // outline
  // -------------------------------------------------------------------------

  /** Dosya özeti; dosya ilgili tarafta yoksa undefined (404). */
  async outline(cs: ChangeSet, path: string, side: Side): Promise<FileOutline | undefined> {
    const changed = side === 'new' ? this.changedNew.get(path) : this.changedOld.get(path);
    const isJava = path.endsWith('.java');
    let model: JavaFileModel | undefined;
    /** Modelin çağrı yerleri indekste bağlı mı (indeksteki nesne) ve satır eşleme. */
    let direct = false;
    let mapLine: ((l: number) => number | undefined) | undefined;
    if (isJava) {
      const { index, newFiles, oldFiles } = this.artifacts;
      if (changed) {
        model = side === 'new' ? newFiles.get(path) : oldFiles.get(path);
        if (model && side === 'new') direct = index.files.get(path) === model;
        if (model && side === 'old') mapLine = this.lineMapper(changed);
      } else {
        model = index.files.get(path);
        direct = model !== undefined;
      }
      // Yalnızca listede yoksa var/yok denetimi gerekir; değişmeyen dosyada eski = head.
      if (!model) model = await this.parseExtra(cs, path, side);
    }
    if (!model) {
      // Java dışı (ya da ayrıştırılamayan) dosya: var mı?
      let content: string | undefined;
      try {
        content = await cs.readFile(side, path);
      } catch {
        content = undefined;
      }
      if (content === undefined) return undefined;
      return { path, side, inDiff: changed !== undefined, decls: [], refs: [] };
    }
    const contextPath = side === 'old' && changed ? changed.path : path;
    const out: FileOutline = {
      path,
      side,
      inDiff: changed !== undefined,
      decls: this.declsOf(model, path, side),
      refs: this.refsOf(model, contextPath, direct ? (l) => l : mapLine),
    };
    if (model.packageName) out.packageName = model.packageName;
    return out;
  }

  private lineMapper(fc: FileChange): (l: number) => number | undefined {
    let m = this.lineMappers.get(fc.path);
    if (!m) {
      m = oldToNewLineMapper(fc);
      this.lineMappers.set(fc.path, m);
    }
    return m;
  }

  /** Artefaktlarda olmayan dosyayı okuyup ayrıştırır (blob SHA varsa ayrıştırma önbelleği). Yoksa undefined. */
  private parseExtra(cs: ChangeSet, path: string, side: Side): Promise<JavaFileModel | undefined> {
    const key = `${side}\u0000${path}`;
    const hit = this.extraModels.get(key);
    if (hit) {
      this.extraModels.delete(key);
      this.extraModels.set(key, hit);
      return hit;
    }
    const p = (async () => {
      let source: string | undefined;
      try {
        source = await cs.readFile(side, path);
      } catch {
        return undefined;
      }
      if (source === undefined) return undefined;
      let cacheKey: string | undefined;
      try {
        cacheKey = cs.blobId ? await cs.blobId(side, path) : undefined;
      } catch {
        cacheKey = undefined;
      }
      try {
        const [m] = await parseJavaFiles([cacheKey ? { path, source, cacheKey } : { path, source }]);
        return m;
      } catch {
        return undefined;
      }
    })();
    this.extraModels.set(key, p);
    while (this.extraModels.size > EXTRA_MODEL_CACHE) {
      const oldest = this.extraModels.keys().next().value;
      if (oldest === undefined) break;
      this.extraModels.delete(oldest);
    }
    return p;
  }

  private declsOf(model: JavaFileModel, path: string, side: Side): SymbolDecl[] {
    const pkg = model.packageName;
    const status = side === 'new' ? this.statusNew : this.statusOld;
    const out: SymbolDecl[] = [];
    for (const t of model.types) {
      const typeId = this.modelId(t.fqn, path, pkg);
      const td: SymbolDecl = {
        id: typeId,
        kind: t.kind,
        name: t.name,
        signature: typeSignature(t),
        range: { ...t.range },
        nameLine: t.nameLine ?? t.range.startLine,
        nameStartCol: t.nameCol ?? 0,
        nameEndCol: t.nameEndCol ?? 0,
      };
      const ts = status.get(typeId);
      if (ts) td.status = ts;
      out.push(td);
      for (const m of t.members) {
        const id = this.modelId(m.id, path, pkg);
        const d: SymbolDecl = {
          id,
          kind: m.kind,
          name: m.name,
          signature: m.signature,
          ownerTypeId: typeId,
          range: { ...m.range },
          nameLine: m.nameLine ?? m.range.startLine,
          nameStartCol: m.nameCol ?? 0,
          nameEndCol: m.nameEndCol ?? 0,
        };
        const ms = status.get(id);
        if (ms) d.status = ms;
        out.push(d);
      }
    }
    out.sort((a, b) => a.nameLine - b.nameLine || a.nameStartCol - b.nameStartCol);
    return out;
  }

  private packagesInRepo(): Set<string> {
    if (!this.repoPackages) {
      const set = new Set<string>();
      for (const f of this.artifacts.index.files.values()) if (f.packageName) set.add(f.packageName);
      this.repoPackages = set;
    }
    return this.repoPackages;
  }

  /**
   * Çözülemeyen tip adı repo dışı mı (JDK/kütüphane): paket nitelikli, java.lang, açık import ya da repo dışı paketten
   * wildcard import. Repo dışıysa referans döndürülmez.
   */
  private isExternalName(name: string, model: JavaFileModel): boolean {
    const first = name.split('.')[0] ?? name;
    if (!/^\p{Lu}/u.test(first)) return true; // paket nitelikli (com.x.Y) ve çözülemedi
    if (JAVA_LANG.has(first)) return true;
    const pkgs = this.packagesInRepo();
    for (const imp of model.imports) {
      if (imp.wildcard) {
        if (!imp.static && !pkgs.has(imp.name)) return true;
        continue;
      }
      const simple = imp.name.slice(imp.name.lastIndexOf('.') + 1);
      if (simple === first) return true;
    }
    return false;
  }

  private refsOf(model: JavaFileModel, contextPath: string, mapLine: ((l: number) => number | undefined) | undefined): SymbolRef[] {
    const { index, ids } = this.artifacts;
    const out: SymbolRef[] = [];
    const callSpans = new Set<string>();
    // satır → en içteki tip ve üye (tip değişkeni ve çözümleme bağlamı için)
    const lineType: (JavaType | undefined)[] = new Array(model.lineCount + 2);
    const lineMember: (JavaMember | undefined)[] = new Array(model.lineCount + 2);
    const byOuterFirst = [...model.types].sort(
      (a, b) => b.range.endLine - b.range.startLine - (a.range.endLine - a.range.startLine),
    );
    for (const t of byOuterFirst) {
      const end = Math.min(t.range.endLine, model.lineCount + 1);
      for (let l = t.range.startLine; l <= end; l++) lineType[l] = t;
    }
    for (const t of byOuterFirst) {
      for (const m of t.members) {
        const end = Math.min(m.range.endLine, model.lineCount + 1);
        for (let l = m.range.startLine; l <= end; l++) if (lineType[l] === t) lineMember[l] = m;
      }
    }
    for (const t of model.types) {
      for (const m of t.members) {
        for (const site of m.callSites) {
          if (site.col === undefined || site.endCol === undefined) continue;
          const line = site.nameLine ?? site.line;
          const ref: SymbolRef = {
            line,
            startCol: site.col,
            endCol: site.endCol,
            name: site.name,
            kind: site.isMethodRef ? 'methodRef' : site.isConstructor ? 'constructor' : 'call',
            targets: [],
          };
          const headLine = mapLine ? mapLine(site.line) : undefined;
          if (headLine !== undefined) {
            const targets = index.targetsOfCallSite(m.id, headLine, site.name);
            if (targets.length) {
              ref.targets = [...new Set(targets.map((x) => ids.toModel(x, contextPath)))];
              const conf = index.callSiteConfidence?.(m.id, headLine, site.name);
              if (conf) ref.confidence = conf;
            }
          }
          // çözülemeyen JDK/kütüphane yapıcısı (`new ArrayList<>()`, `new Runnable() {}`): gürültü
          if (ref.kind === 'constructor' && ref.targets.length === 0 && this.isExternalName(site.name, model)) continue;
          callSpans.add(`${line}:${site.col}`);
          out.push(ref);
        }
      }
    }
    for (const r of decodeTypeRefPositions(model.typeRefPositions)) {
      if (callSpans.has(`${r.line}:${r.col}`)) continue; // `new Foo()`: yapıcı referansı zaten var
      const t = lineType[r.line];
      const first = r.name.split('.')[0] ?? r.name;
      if (this.isTypeVar(first, t, lineMember[r.line], model)) continue;
      const fqn = index.resolveTypeName(r.name, model, t);
      if (fqn === undefined) {
        if (r.expr || this.isExternalName(r.name, model)) continue;
        out.push({ line: r.line, startCol: r.col, endCol: r.endCol, name: r.name, kind: 'type', targets: [] });
        continue;
      }
      out.push({
        line: r.line,
        startCol: r.col,
        endCol: r.endCol,
        name: r.name,
        kind: 'type',
        targets: [ids.toModel(fqn, contextPath)],
        confidence: 'exact',
      });
    }
    out.sort((a, b) => a.line - b.line || a.startCol - b.startCol);
    return out;
  }

  private isTypeVar(name: string, t: JavaType | undefined, m: JavaMember | undefined, model: JavaFileModel): boolean {
    if (m && typeParamNames(m.typeParams).includes(name)) return true;
    for (let cur = t; cur; cur = cur.outerFqn ? model.types.find((x) => x.fqn === cur?.outerFqn) : undefined) {
      if (typeParamNames(cur.typeParams).includes(name)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // locate
  // -------------------------------------------------------------------------

  /** Sembolün konumu; bulunamazsa undefined (404). */
  locate(id: string): SymbolLocation | undefined {
    const anon = ANON_RE.exec(id);
    if (anon?.[1]) {
      const base = this.locate(anon[1]);
      if (!base) return undefined;
      const out: SymbolLocation = { ...base, id, kind: 'method', name: anon[3] ?? base.name };
      delete out.signature;
      return out;
    }
    const found = this.findChanged(id, 'new') ?? this.findInIndex(id) ?? this.findChanged(id, 'old') ?? this.findInModel(id);
    if (!found) return undefined;
    const inDiff = found.side === 'new' ? this.changedNew.has(found.path) : this.changedOld.has(found.path);
    const loc: SymbolLocation = {
      id,
      kind: found.kind,
      name: found.name,
      path: found.path,
      side: found.side,
      range: { ...found.range },
      inDiff,
      typeId: found.typeId,
    };
    if (found.signature !== undefined) loc.signature = found.signature;
    return loc;
  }

  private findChanged(id: string, side: Side): Located | undefined {
    if (!this.changedSymbols) {
      const build = (files: ReadonlyMap<string, JavaFileModel>, s: Side): Map<string, Located> => {
        const map = new Map<string, Located>();
        for (const [path, model] of files) {
          for (const t of model.types) {
            const typeId = this.modelId(t.fqn, path, model.packageName);
            if (!map.has(typeId)) map.set(typeId, { ...typeLocated(t, path, s), typeId });
            for (const m of t.members) {
              const mid = this.modelId(m.id, path, model.packageName);
              if (!map.has(mid)) map.set(mid, { ...memberLocated(m, path, s), typeId });
            }
          }
        }
        return map;
      };
      this.changedSymbols = { newMap: build(this.artifacts.newFiles, 'new'), oldMap: build(this.artifacts.oldFiles, 'old') };
    }
    return (side === 'new' ? this.changedSymbols.newMap : this.changedSymbols.oldMap).get(id);
  }

  private findInIndex(id: string): Located | undefined {
    const { index } = this.artifacts;
    const plain = stripRootSuffix(id);
    const root = rootOfModelId(id);
    const { owner, rest } = ownerOf(plain);
    const cands = index.typesByFqn(owner);
    let pick = cands[0];
    if (root !== undefined) {
      const r = cands.find((c) => sourceRootFor(c.file.path, c.file.packageName) === root);
      if (r) pick = r;
      else if (cands.length > 0) return undefined; // istenen kök yok
    } else {
      const def = index.getType(owner);
      const d = def ? cands.find((c) => c.type === def) : undefined;
      if (d) pick = d;
    }
    if (!pick) return undefined;
    const { type, file } = pick;
    const typeId = this.modelId(type.fqn, file.path, file.packageName);
    if (!rest) return { ...typeLocated(type, file.path, 'new'), typeId };
    const m = type.members.find((x) => x.id === plain);
    if (m) return { ...memberLocated(m, file.path, 'new'), typeId };
    // aynı FQN'li başka adayda olabilir (indeks varsayılanı)
    const rm = root === undefined ? index.getMember(plain) : undefined;
    if (!rm) return undefined;
    return { ...memberLocated(rm.member, rm.file.path, 'new'), typeId: this.modelId(rm.type.fqn, rm.file.path, rm.file.packageName) };
  }

  /** Son çare: ReviewModel aralıkları (dosyası analiz edilemeyen sembol). */
  private findInModel(id: string): Located | undefined {
    const fileOf = (path: string) => this.model.files.find((f) => f.path === path);
    for (const t of this.model.types) {
      const f = fileOf(t.file);
      const where = (newRange: Range | undefined, oldRange: Range | undefined) =>
        newRange
          ? { path: t.file, side: 'new' as const, range: newRange }
          : oldRange
            ? { path: f?.oldPath ?? t.file, side: 'old' as const, range: oldRange }
            : undefined;
      if (t.id === id) {
        const w = where(t.newRange, t.oldRange);
        if (w) return { kind: t.kind, name: t.name, typeId: t.id, ...w };
      }
      for (const m of t.members) {
        if (m.id !== id) continue;
        const w = where(m.newRange, m.oldRange);
        if (w) return { kind: m.kind, name: m.name, signature: m.signature, typeId: t.id, ...w };
      }
    }
    return undefined;
  }
}

function typeLocated(t: JavaType, path: string, side: Side): Omit<Located, 'typeId'> {
  return { kind: t.kind, name: t.name, signature: typeSignature(t), path, side, range: t.range };
}

function memberLocated(m: JavaMember, path: string, side: Side): Omit<Located, 'typeId'> {
  return { kind: m.kind, name: m.name, signature: m.signature, path, side, range: m.range };
}

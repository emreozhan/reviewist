/**
 * TypeDiff'leri repo indeksiyle zenginleştirir: üst/alt tipler, override ilişkileri, çağıranlar/çağrılanlar,
 * silinmiş/değişmiş ama head'de hâlâ eski haliyle çağrılan üyeler ve kırılan override'lar.
 *
 * Bayat çağrı (silinmiş/adı/arity'si değişmiş üyeye head'de kalan çağrı) kuralları:
 *  - Çağrı yeri head'de var olan başka bir üyeye bağlanıyorsa (`targetsOfCallSite`; ör. iç sınıfın aynı adlı metodu,
 *    başka sınıftan statik import) bayat değildir.
 *  - Head tipinde (veya üst tiplerinde) aynı ad + arity'de üye kaldıysa çağrılar ona gider; yalnız argüman tipleri
 *    kesin olarak çıkarılabilen ve kalan hiçbir aday overload'a uymayan çağrılar 'likely' bayat sayılır (B2).
 *  - Açık yapıcısı kalmayan tipte argümansız `new X()` örtük varsayılan yapıcıya gider.
 *  - Sahip tip silindiyse eski modelin üst tipleri head'de çözülür; kalıtılan üye varsa çağrı geçerlidir.
 *  - Alıcısı çözülemeyen ('name-only') çağrılar bulgu/risk üretmez; yalnızca sayılır (ctx.unverifiedStaleCalls).
 *
 * Çift FQN (ctx.ids): indekse soneksiz id ile gidilir, indeksten gelen id'ler bağlam dosyasının kaynak köküne göre
 * model id'sine çevrilir.
 */
import type { CallRef } from '../../shared/types.js';
import type { CallSite, JavaFileModel, JavaMember, JavaType, ResolvedMember, TypeDiff } from '../java/model.js';
import { eraseTypeForId } from '../java/names.js';
import { argCompatibility, inferArgType, typeVarsOf } from './argTypes.js';
import type { AnalysisContext, AnalyzedFile } from './context.js';
import { isSemanticChange } from './risk.js';
import { rootOfModelId, sourceRootFor } from './symbolIds.js';
import { annotationName, packageOf, simpleTypeName } from './util.js';

/** ctx.members / ctx.types haritalarını doldurur. Aynı id iki kez gelirse head tarafı olan tercih edilir. */
export function registerSymbols(ctx: AnalysisContext): void {
  for (const af of ctx.files) {
    for (const td of af.typeDiffs) {
      const prevT = ctx.types.get(td.change.id);
      if (!prevT || (!prevT.td.newType && td.newType)) ctx.types.set(td.change.id, { td, af });
      for (const md of td.members) {
        const prev = ctx.members.get(md.change.id);
        if (!prev || (!prev.md.newMember && md.newMember) || (!isSemanticChange(prev.md.change.status) && isSemanticChange(md.change.status))) {
          ctx.members.set(md.change.id, { md, td, af });
        }
      }
    }
  }
}

export function markChangedCode(ctx: AnalysisContext, calls: readonly CallRef[]): CallRef[] {
  return calls.map((c) => ({ ...c, inChangedCode: ctx.byPath.get(c.file)?.addedLines.has(c.line) ?? false }));
}

const CONFIDENCE_RANK: Record<CallRef['confidence'], number> = { exact: 2, likely: 1, 'name-only': 0 };

/**
 * Aynı (fromId, line) çağrısını teke indirir; güveni en yüksek olan kalır. İlk görülme sırası korunur.
 * (Doğrudan çağrı + arayüz üzerinden polimorfik çağrı aynı satıra iki kez düşebilir.)
 */
export function dedupeCallers(calls: readonly CallRef[]): CallRef[] {
  const byKey = new Map<string, CallRef>();
  for (const c of calls) {
    const key = `${c.fromId}|${c.line}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, c);
    else if (CONFIDENCE_RANK[c.confidence] > CONFIDENCE_RANK[prev.confidence]) byKey.set(key, { ...c, inChangedCode: prev.inChangedCode || c.inChangedCode });
  }
  return [...byKey.values()];
}

/**
 * Doğrudan çağıranlar + override edilen üst tip metotlarının çağıranları (arayüz/port üzerinden polimorfik çağrı).
 * Polimorfik çağrılar 'likely' güvenle eklenir. Sonuçta (fromId, line) tekrarı yoktur; en yüksek güven kalır.
 * Girdi ve çıktı indeks id'leridir.
 */
function withPolymorphicCallers(ctx: AnalysisContext, id: string, overrides: readonly string[]): CallRef[] {
  const out = [...ctx.index.callersOf(id)];
  for (const sup of overrides) {
    for (const c of ctx.index.callersOf(sup)) out.push({ ...c, confidence: c.confidence === 'exact' ? 'likely' : c.confidence });
  }
  return dedupeCallers(out);
}

function arityMatches(m: JavaMember, argCount: number): boolean {
  if (m.params.length === argCount) return true;
  const last = m.params[m.params.length - 1];
  return !!last?.varargs && argCount >= m.params.length - 1;
}

function idSuffix(id: string): string {
  return id.slice(id.indexOf('#') + 1);
}

/** Değişen (silinmiş olabilir) dosyanın kaynak kökü: eski/yeni modelin paket adıyla. */
function ownRootFromDiff(ctx: AnalysisContext, path: string): string | undefined {
  const af = ctx.byPath.get(path);
  const model = af?.newModel ?? af?.oldModel;
  return model ? sourceRootFor(path, model.packageName) : undefined;
}

/** Bir head dosyasının kaynak kökü (indeksteki paket adıyla). */
function rootOfPath(ctx: AnalysisContext, path: string): string | undefined {
  const model = ctx.index.files.get(path) ?? ctx.byPath.get(path)?.newModel;
  return model ? sourceRootFor(path, model.packageName) : undefined;
}

/**
 * Aynı FQN birden çok kaynak kökünde varsa `contextPath`'in kökündeki tanımlar. O kökte tanım yoksa: `strict` ise boş
 * (ör. tip yalnız bu kökte silindi), değilse hepsi (üçüncü kökten gelen çağrı).
 */
function headEntries(ctx: AnalysisContext, fqn: string, contextPath: string | undefined, strict = false): { type: JavaType; file: JavaFileModel }[] {
  const entries = ctx.index.typesByFqn(fqn);
  if (entries.length === 0) {
    const type = ctx.index.getType(fqn);
    const file = ctx.index.getFileOfType(fqn);
    return type && file ? [{ type, file }] : [];
  }
  if (entries.length === 1 || contextPath === undefined) return entries;
  const root = rootOfPath(ctx, contextPath);
  const same = entries.filter((e) => sourceRootFor(e.file.path, e.file.packageName) === root);
  return same.length || strict ? same : entries;
}

/** Sembol (tip ya da üye id'si) head'de, bağlam dosyasının kaynak kökünde var mı. */
function existsInHead(ctx: AnalysisContext, id: string, contextPath: string | undefined): boolean {
  const hash = id.indexOf('#');
  const owner = hash < 0 ? id : id.slice(0, hash);
  const entries = headEntries(ctx, owner, contextPath);
  if (entries.length === 0) return hash < 0 ? ctx.index.getType(id) !== undefined : ctx.index.getMember(id) !== undefined;
  return hash < 0 || entries.some((e) => e.type.members.some((m) => m.id === id));
}

/**
 * Çift FQN'de indeks ilişkileri (çağıran, alt tip, override eden) soneksiz id üzerinden tüm köklerden gelir. Yalnız bu
 * varyanta ait olanlar tutulur: ilişkili dosya varyant köklerinden birindeyse aynı kök; değilse (üçüncü kök) indeksin
 * varsayılan adayı.
 */
function variantFilter(ctx: AnalysisContext, modelId: string, ownPath: string): (path: string | undefined) => boolean {
  const plain = ctx.ids.toIndex(modelId);
  const owner = plain.includes('#') ? plain.slice(0, plain.indexOf('#')) : plain;
  const entries = ctx.index.typesByFqn(owner);
  const myRoot = rootOfModelId(modelId) ?? rootOfPath(ctx, ownPath) ?? ownRootFromDiff(ctx, ownPath);
  if (myRoot === undefined) return () => true;
  const variantRoots = new Set(entries.map((e) => sourceRootFor(e.file.path, e.file.packageName)));
  if (variantRoots.size === 0 || (variantRoots.size === 1 && variantRoots.has(myRoot))) return () => true;
  variantRoots.add(myRoot);
  const def = ctx.index.getFileOfType(owner);
  const defaultRoot = def ? sourceRootFor(def.path, def.packageName) : undefined;
  return (path) => {
    if (path === undefined) return true;
    const r = rootOfPath(ctx, path);
    if (r !== undefined && variantRoots.has(r)) return r === myRoot;
    return defaultRoot === undefined || defaultRoot === myRoot;
  };
}

export function enrich(ctx: AnalysisContext): void {
  const { index, ids } = ctx;
  for (const af of ctx.files) {
    for (const td of af.typeDiffs) {
      const ch = td.change;
      const path = af.file.path;
      const toModel = (id: string) => ids.toModel(id, path);
      const mine = variantFilter(ctx, ch.id, path);
      const pathOfSymbol = (id: string) => (id.includes('#') ? index.getMember(id)?.file.path : index.getFileOfType(id)?.path);
      try {
        if (td.newType && td.newFile) {
          const nt = td.newType;
          const nf = td.newFile;
          const raw = [...(nt.superclass ? [nt.superclass] : []), ...nt.interfaces];
          ch.superTypes = raw.map((n) => index.resolveTypeName(n, nf, nt) ?? n).map(toModel);
          ch.subTypes = index
            .subTypesOf(ids.toIndex(ch.id))
            .filter((s) => mine(pathOfSymbol(s)))
            .map(toModel);
        }
        if (td.oldType && td.oldFile) {
          const ot = td.oldType;
          const of = td.oldFile;
          const raw = [...(ot.superclass ? [ot.superclass] : []), ...ot.interfaces];
          ch.oldSuperTypes = raw.map((n) => index.resolveTypeName(n, of, ot) ?? n).map(toModel);
        }

        for (const md of td.members) {
          const mc = md.change;
          const iid = ids.toIndex(mc.id);
          const semantic = isSemanticChange(mc.status);
          let overridesIdx: string[] = [];
          if (md.newMember && md.newMember.kind === 'method') {
            overridesIdx = index.overridesOf(iid);
            mc.overrides = overridesIdx.map(toModel);
            mc.overriddenBy = index
              .overriddenBy(iid)
              .filter((o) => mine(pathOfSymbol(o)))
              .map(toModel);
          }
          if (semantic && md.newMember) {
            mc.callers = markChangedCode(ctx, withPolymorphicCallers(ctx, iid, overridesIdx))
              .filter((c) => mine(c.file))
              .map((c) => ({ ...c, fromId: ids.toModel(c.fromId, c.file) }));
            mc.callees = index.calleesOf(iid).map(toModel);
          }
          if (semantic && md.oldMember) {
            findStale(ctx, af, td, mc.id, mc.status, md.oldMember, md.newMember);
          }
        }

        // Silinmiş / yeniden adlandırılmış tipe hâlâ referans var mı
        // (İç tipler dış tipleriyle birlikte taşınır; yalnızca üst düzey tipler kontrol edilir.)
        const oldModelId = ch.status === 'removed' ? ch.id : (ch.status === 'renamed' || ch.status === 'moved') && ch.oldId && ch.oldId !== ch.id ? ch.oldId : undefined;
        const oldFqn = oldModelId !== undefined ? ids.toIndex(oldModelId) : undefined;
        if (oldFqn && headEntries(ctx, oldFqn, path, true).length === 0 && !td.oldType?.outerFqn) {
          const simple = simpleTypeName(oldFqn);
          const refs = index.filesReferencingType(oldFqn).filter((p) => {
            const model = index.files.get(p);
            if (!mine(p)) return false; // başka kökteki aynı adlı (hâlâ var olan) varyanta referans
            if (!model || p === td.newFile?.path || ctx.byPath.get(p)?.cs.status === 'deleted') return false;
            // Dosya bu adı artık başka (var olan) bir tipe çözüyorsa (ör. yeni paketi import ediyor) referans bayat değildir.
            const resolved = index.resolveTypeName(simple, model);
            return resolved === undefined || resolved === oldFqn;
          });
          if (refs.length) ctx.staleTypeRefs.set(ch.id, refs);
        }
      } catch (error) {
        ctx.warnings.push(`${af.file.path}: ${ch.name} zenginleştirilemedi (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }
}

/** Sahip tip head'de yoksa eski modelin (çözülebilen) üst tipleri; varsa sahip tipin kendisi. */
function hierarchyRoots(ctx: AnalysisContext, td: TypeDiff, owner: string, ownerInHead: boolean): string[] {
  if (ownerInHead) return [owner];
  const ot = td.oldType;
  const of = td.oldFile;
  if (!ot || !of || ot.fqn !== owner) return [];
  const raw = [...(ot.superclass ? [ot.superclass] : []), ...ot.interfaces];
  return raw.map((n) => ctx.index.resolveTypeName(n, of, ot)).filter((x): x is string => x !== undefined && x !== owner);
}

/** Kökler ve üst tiplerindeki (yapıcıda yalnız kökler) aynı ad ve arity'deki head üyeleri. */
function overloadsFrom(ctx: AnalysisContext, roots: readonly string[], contextPath: string, kind: JavaMember['kind'], name: string, arity: number): ResolvedMember[] {
  const out: ResolvedMember[] = [];
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const fqn = queue.shift() as string;
    if (seen.has(fqn)) continue;
    seen.add(fqn);
    // Kökler (sahip tip) kendi kaynak kökünde aranır; üst tipler başka kökte olabilir (test kökü → main kökü).
    for (const { type, file } of headEntries(ctx, fqn, contextPath, roots.includes(fqn))) {
      for (const m of type.members) if (m.kind === kind && m.name === name && arityMatches(m, arity)) out.push({ member: m, type, file });
    }
    // Yapıcılar kalıtılmaz: yalnız köklerin kendisi.
    if (kind !== 'constructor') queue.push(...ctx.index.superTypesOf(fqn));
  }
  return out;
}

function findSite(member: JavaMember, line: number, name: string, arity: number): CallSite | undefined {
  return member.callSites.find(
    (s) => s.line === line && !s.isMethodRef && s.argCount === arity && (s.isConstructor ? simpleTypeName(s.name) === name : s.name === name),
  );
}

/**
 * Çağrının çıkarılabilen argüman tipleri adaylardan hiçbirine uymuyor mu. Argümanlar çıkarılamıyorsa (veya hiç aday
 * yoksa) false: emin olunamayan durumda sessiz kalınır.
 */
function fitsNoCandidate(ctx: AnalysisContext, call: CallRef, name: string, arity: number, candidates: readonly ResolvedMember[]): boolean {
  if (candidates.length === 0) return false;
  const caller = ctx.index.getMember(call.fromId);
  if (!caller) return false;
  const site = findSite(caller.member, call.line, name, arity);
  if (!site?.args || site.args.length !== arity) return false;
  const argTypes = site.args.map((a) => inferArgType(a, caller.member, caller.type));
  if (argTypes.every((t) => t === undefined)) return false;
  return !candidates.some((cand) => {
    const vars = typeVarsOf(cand.member, cand.type);
    const params = cand.member.params;
    if (!arityMatches(cand.member, arity)) return false;
    return argTypes.every((at, i) => {
      if (at === undefined) return true;
      const p = params[Math.min(i, params.length - 1)];
      if (!p) return true;
      return argCompatibility(ctx.index, at, { file: caller.file, type: caller.type }, p.type, { file: cand.file, type: cand.type }, vars) !== 'mismatch';
    });
  });
}

/**
 * Dosya (head) `fqn` tipini adıyla görebilir mi: basit ad dosyada tip referansı olarak geçiyor ve tip aynı paketten,
 * tekil/wildcard importla ya da (iç tipse) dış tip adı üzerinden erişilebilir.
 */
function mayReferenceType(ctx: AnalysisContext, path: string, fqn: string, outerFqn: string | undefined): boolean {
  const model = ctx.index.files.get(path);
  if (!model) return true; // bilinmiyorsa eleme yapılmaz
  const simple = simpleTypeName(fqn);
  const refs = model.typeRefs ? new Set(model.typeRefs) : undefined;
  const mentions = (name: string) => (refs ? refs.has(name) : new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(model.normalizedCode));
  if (!mentions(simple)) return false;
  const pkg = packageOf(outerFqn ?? fqn);
  if (outerFqn) {
    const outerSimple = simpleTypeName(outerFqn);
    if (model.imports.some((i) => !i.static && !i.wildcard && i.name === fqn)) return true;
    if (model.imports.some((i) => i.wildcard && i.name === outerFqn)) return true;
    // Dış tip adıyla (Outer.Inner) ya da dış tipin bulunduğu dosya/paket içinden
    return mentions(outerSimple) && (model.packageName === pkg || model.imports.some((i) => (!i.wildcard && i.name === outerFqn) || (i.wildcard && i.name === pkg)));
  }
  return model.packageName === pkg || model.imports.some((i) => (!i.wildcard && i.name === fqn) || (i.wildcard && i.name === pkg));
}

function hasOverrideAnnotation(m: JavaMember): boolean {
  return m.annotations.some((a) => annotationName(a) === 'Override');
}

const OBJECT_METHODS = new Set(['equals(Object)', 'hashCode()', 'toString()', 'clone()', 'finalize()']);

/** Tipin (geçişli) üst tiplerinden biri repo dışında mı (dış üst tipteki bir metodu override ediyor olabilir). */
function hasExternalSuper(ctx: AnalysisContext, fqn: string): boolean {
  const seen = new Set<string>();
  const queue = [fqn];
  while (queue.length) {
    const cur = queue.shift() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const s of ctx.index.superTypesOf(cur)) {
      if (!ctx.index.getType(s)) return true;
      queue.push(s);
    }
  }
  return false;
}

function findStale(ctx: AnalysisContext, af: AnalyzedFile, td: TypeDiff, id: string, status: string, oldM: JavaMember, newM: JavaMember | undefined): void {
  if (oldM.kind !== 'method' && oldM.kind !== 'constructor') return;
  const { index } = ctx;
  const path = af.file.path;
  const owner = oldM.ownerFqn;
  const isCtor = oldM.kind === 'constructor';
  const name = isCtor ? simpleTypeName(owner) : oldM.name;
  const arity = oldM.params.length;
  const relevant =
    status === 'removed' ||
    status === 'renamed' ||
    status === 'moved' ||
    (status === 'signatureChanged' && (!newM || newM.params.length !== arity || newM.name !== oldM.name));
  if (!relevant) {
    if (status === 'signatureChanged' && newM) findTypeMismatchedCalls(ctx, af, id, oldM, newM, name);
    return;
  }
  const headOwner = headEntries(ctx, owner, path, true)[0]?.type;
  const mine = variantFilter(ctx, id, path);
  const roots = isCtor ? (headOwner ? [owner] : []) : hierarchyRoots(ctx, td, owner, headOwner !== undefined);
  // Örtük varsayılan yapıcı: açık yapıcısı kalmayan tipte argümansız çağrı geçerlidir.
  const implicitDefaultCtor = isCtor && arity === 0 && headOwner !== undefined && !headOwner.members.some((m) => m.kind === 'constructor');
  if (!implicitDefaultCtor) {
    const remaining = overloadsFrom(ctx, roots, path, oldM.kind, oldM.name, arity);
    const remainingIds = new Set(remaining.map((r) => r.member.id));
    const stale: CallRef[] = [];
    let unverified = 0;
    for (const call of dedupeCallers(index.findCallsTo(owner, name, arity))) {
      if (!index.files.has(call.file)) continue;
      if (!mine(call.file)) continue; // çift FQN: başka kökün varyantına giden çağrı
      // Sahip tip head'de yoksa çağrı ancak o tipi adıyla görebilen dosyada derlenirdi (aynı adlı JDK tipi —
      // java.util.Iterator ↔ silinen iç sınıf Iterator — üzerinden yapılan çağrılar sayılmaz).
      if (!headOwner && call.file !== path && !mayReferenceType(ctx, call.file, owner, td.oldType?.outerFqn)) continue;
      // (Aynı id başka bir kaynak kökünde hâlâ bildiriliyor olabilir: varlık, çağrının kökünde kontrol edilir.)
      const live = index.targetsOfCallSite(call.fromId, call.line, name).filter((t) => existsInHead(ctx, t, call.file));
      if (remaining.length === 0) {
        // Çağrı yeri head'de var olan başka bir üyeye bağlanıyor: bayat değil.
        if (live.length > 0) continue;
        if (call.confidence === 'name-only') {
          unverified++;
          continue;
        }
        stale.push(call);
      } else {
        // Aynı arity'de overload kaldı (B2): yalnız argüman tipleri kalan adayların hiçbirine uymuyorsa bayat.
        if (call.confidence === 'name-only') continue;
        // Çağrı sahip hiyerarşisi dışındaki bir üyeye bağlanıyorsa (ör. üst arayüz metodu başka tipte) bu üyeyle ilgisi yok.
        // (Kalan overload'u override eden alt tip üyesine bağlanması da sahip hiyerarşisidir.)
        if (live.length > 0 && !live.some((t) => remainingIds.has(t) || index.overridesOf(t).some((o) => remainingIds.has(o)))) continue;
        const liveMembers = live.map((t) => index.getMember(t)).filter((r): r is ResolvedMember => r !== undefined);
        if (fitsNoCandidate(ctx, call, name, arity, [...remaining, ...liveMembers])) stale.push({ ...call, confidence: 'likely' });
      }
    }
    if (stale.length) ctx.staleCalls.set(id, markChangedCode(ctx, stale).map((c) => ({ ...c, fromId: ctx.ids.toModel(c.fromId, c.file) })));
    if (unverified) ctx.unverifiedStaleCalls.set(id, unverified);
  }
  // Alt sınıflarda eski imzayla kalan metotlar artık override etmiyor olabilir
  if (oldM.kind === 'method' && oldM.visibility !== 'private' && !oldM.modifiers.includes('static') && headOwner) {
    const oldSig = idSuffix(oldM.id);
    if (OBJECT_METHODS.has(oldSig)) return;
    if (!headOwner.members.some((m) => m.kind === 'method' && idSuffix(m.id) === oldSig)) {
      const broken: string[] = [];
      const orphaned: string[] = [];
      for (const sub of index.subTypesOf(owner, true)) {
        const candidate = `${sub}#${oldSig}`;
        const rm = index.getMember(candidate);
        if (!rm) continue;
        // Head'de hâlâ bir şeyi override ediyor (ör. metot üst arayüze taşındı): kopma yok.
        if (index.overridesOf(candidate).length > 0) continue;
        // Repo dışı bir üst tipteki metodu override ediyor olabilir: emin olunamaz.
        if (hasExternalSuper(ctx, sub)) continue;
        const modelId = ctx.ids.toModel(candidate, rm.file.path);
        if (hasOverrideAnnotation(rm.member)) broken.push(modelId);
        else orphaned.push(modelId);
      }
      if (broken.length) ctx.brokenOverrides.set(id, broken);
      if (orphaned.length) ctx.orphanedOverrides.set(id, orphaned);
    }
  }
}

/**
 * Aynı ad + arity, ama parametre tipleri değişmiş metot/yapıcı: head'deki çağrıların argüman tipleri çıkarılabiliyor ve
 * hiçbir aday overload'a uymuyorsa çağrı 'likely' güvenle bayat sayılır. Çıkarılamayan argümanlarda sessiz kalınır.
 */
function findTypeMismatchedCalls(ctx: AnalysisContext, af: AnalyzedFile, id: string, oldM: JavaMember, newM: JavaMember, name: string): void {
  if (newM.name !== oldM.name || newM.params.length !== oldM.params.length) return;
  const typesChanged = oldM.params.some((p, i) => eraseTypeForId(p.type) !== eraseTypeForId(newM.params[i].type));
  if (!typesChanged) return;
  const { index } = ctx;
  const arity = newM.params.length;
  const candidates = overloadsFrom(ctx, [newM.ownerFqn], af.file.path, newM.kind, newM.name, arity);
  if (!candidates.length) return;
  const stale: CallRef[] = [];
  const mine = variantFilter(ctx, id, af.file.path);
  const ownId = ctx.ids.toIndex(id);
  for (const call of index.findCallsTo(newM.ownerFqn, name, arity)) {
    if (!index.files.has(call.file) || call.confidence === 'name-only' || !mine(call.file)) continue;
    // Çağrı yeri başka bir (var olan) üyeye bağlıysa — ör. üst arayüzün metoduna — bu imza değişikliğinden etkilenmez.
    const targets = index.targetsOfCallSite(call.fromId, call.line, name);
    if (targets.length > 0 && !targets.includes(ownId) && !targets.some((t) => candidates.some((c) => c.member.id === t && c.type.fqn === newM.ownerFqn))) continue;
    if (fitsNoCandidate(ctx, call, name, arity, candidates)) stale.push({ ...call, confidence: 'likely' });
  }
  if (stale.length) ctx.staleCalls.set(id, markChangedCode(ctx, dedupeCallers(stale)).map((c) => ({ ...c, fromId: ctx.ids.toModel(c.fromId, c.file) })));
}

/**
 * Diff dışındaki (değişmemiş sembollerden gelen) farklı çağıran id'leri. `confidence` verilirse yalnızca o güvendeki
 * çağrılar sayılır.
 */
export function outsideCallerIds(ctx: AnalysisContext, callers: readonly CallRef[], confidence?: CallRef['confidence']): string[] {
  const out = new Set<string>();
  for (const c of callers) {
    if (c.inChangedCode) continue;
    if (confidence !== undefined && c.confidence !== confidence) continue;
    const e = ctx.members.get(c.fromId);
    if (e && isSemanticChange(e.md.change.status)) continue;
    out.add(c.fromId);
  }
  return [...out];
}

/**
 * TypeDiff'leri repo indeksiyle zenginleştirir: üst/alt tipler, override ilişkileri, çağıranlar/çağrılanlar,
 * silinmiş/değişmiş ama head'de hâlâ eski haliyle çağrılan üyeler ve kırılan override'lar.
 */
import type { CallRef } from '../../shared/types.js';
import type { JavaMember, ResolvedMember } from '../java/model.js';
import { eraseTypeForId } from '../java/names.js';
import { argCompatibility, inferArgType, typeVarsOf } from './argTypes.js';
import type { AnalysisContext } from './context.js';
import { isSemanticChange } from './risk.js';
import { simpleTypeName } from './util.js';

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

export function enrich(ctx: AnalysisContext): void {
  const { index } = ctx;
  for (const af of ctx.files) {
    for (const td of af.typeDiffs) {
      const ch = td.change;
      try {
        if (td.newType && td.newFile) {
          const nt = td.newType;
          const nf = td.newFile;
          const raw = [...(nt.superclass ? [nt.superclass] : []), ...nt.interfaces];
          ch.superTypes = raw.map((n) => index.resolveTypeName(n, nf, nt) ?? n);
          ch.subTypes = index.subTypesOf(ch.id);
        }
        if (td.oldType && td.oldFile) {
          const ot = td.oldType;
          const of = td.oldFile;
          const raw = [...(ot.superclass ? [ot.superclass] : []), ...ot.interfaces];
          ch.oldSuperTypes = raw.map((n) => index.resolveTypeName(n, of, ot) ?? n);
        }

        for (const md of td.members) {
          const mc = md.change;
          const semantic = isSemanticChange(mc.status);
          if (md.newMember && (md.newMember.kind === 'method')) {
            mc.overrides = index.overridesOf(mc.id);
            mc.overriddenBy = index.overriddenBy(mc.id);
          }
          if (semantic && md.newMember) {
            mc.callers = markChangedCode(ctx, withPolymorphicCallers(ctx, mc.id, mc.overrides));
            mc.callees = index.calleesOf(mc.id);
          }
          if (semantic && md.oldMember) {
            findStale(ctx, mc.id, mc.status, md.oldMember, md.newMember);
          }
        }

        // Silinmiş / yeniden adlandırılmış tipe hâlâ referans var mı
        // (İç tipler dış tipleriyle birlikte taşınır; yalnızca üst düzey tipler kontrol edilir.)
        const oldFqn = ch.status === 'removed' ? ch.id : (ch.status === 'renamed' || ch.status === 'moved') && ch.oldId && ch.oldId !== ch.id ? ch.oldId : undefined;
        if (oldFqn && !index.getType(oldFqn) && !td.oldType?.outerFqn) {
          const simple = simpleTypeName(oldFqn);
          const refs = index.filesReferencingType(oldFqn).filter((p) => {
            const model = index.files.get(p);
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

function findStale(ctx: AnalysisContext, id: string, status: string, oldM: JavaMember, newM: JavaMember | undefined): void {
  if (oldM.kind !== 'method' && oldM.kind !== 'constructor') return;
  const { index } = ctx;
  const owner = oldM.ownerFqn;
  const name = oldM.kind === 'constructor' ? simpleTypeName(owner) : oldM.name;
  const arity = oldM.params.length;
  const relevant =
    status === 'removed' ||
    status === 'renamed' ||
    status === 'moved' ||
    (status === 'signatureChanged' && (!newM || newM.params.length !== arity || newM.name !== oldM.name));
  if (!relevant) {
    if (status === 'signatureChanged' && newM) findTypeMismatchedCalls(ctx, id, oldM, newM, name);
    return;
  }
  const headOwner = index.getType(owner);
  // Head'de sahip tipte veya üst tiplerinde aynı ad ve uyumlu arity'de metot kaldıysa (overload / kalıtılan) çağrılar ona gider.
  const stillCallable = hierarchyHas(ctx, owner, oldM.kind, oldM.name, arity);
  if (!stillCallable) {
    const calls = index.findCallsTo(owner, name, arity).filter((c) => index.files.has(c.file));
    if (calls.length) ctx.staleCalls.set(id, markChangedCode(ctx, calls));
  }
  // Alt sınıflarda eski imzayla kalan metotlar artık override etmiyor
  if (oldM.kind === 'method' && oldM.visibility !== 'private' && !oldM.modifiers.includes('static') && headOwner) {
    const oldSig = idSuffix(oldM.id);
    if (!headOwner.members.some((m) => m.kind === 'method' && idSuffix(m.id) === oldSig)) {
      const broken: string[] = [];
      for (const sub of index.subTypesOf(owner, true)) {
        const candidate = `${sub}#${oldSig}`;
        if (index.getMember(candidate)) broken.push(candidate);
      }
      if (broken.length) ctx.brokenOverrides.set(id, broken);
    }
  }
}

/**
 * Aynı ad + arity, ama parametre tipleri değişmiş metot/yapıcı: head'deki çağrıların argüman tipleri çıkarılabiliyor ve
 * hiçbir aday overload'a uymuyorsa çağrı 'likely' güvenle bayat sayılır. Çıkarılamayan argümanlarda sessiz kalınır.
 */
function findTypeMismatchedCalls(ctx: AnalysisContext, id: string, oldM: JavaMember, newM: JavaMember, name: string): void {
  if (newM.name !== oldM.name || newM.params.length !== oldM.params.length) return;
  const typesChanged = oldM.params.some((p, i) => eraseTypeForId(p.type) !== eraseTypeForId(newM.params[i].type));
  if (!typesChanged) return;
  const { index } = ctx;
  const arity = newM.params.length;
  const candidates = overloadsInHierarchy(ctx, newM.ownerFqn, newM.kind, newM.name, arity);
  if (!candidates.length) return;
  const stale: CallRef[] = [];
  for (const call of index.findCallsTo(newM.ownerFqn, name, arity)) {
    if (!index.files.has(call.file)) continue;
    const caller = index.getMember(call.fromId);
    if (!caller) continue;
    const site = caller.member.callSites.find((s) => s.line === call.line && s.name === name && !s.isMethodRef && s.argCount === arity && s.args?.length === arity);
    if (!site?.args) continue;
    const argTypes = site.args.map((a) => inferArgType(a, caller.member, caller.type));
    if (argTypes.every((t) => t === undefined)) continue;
    const fitsSome = candidates.some((cand) => {
      const vars = typeVarsOf(cand.member, cand.type);
      return cand.member.params.every((p, i) => {
        const at = argTypes[i];
        if (at === undefined) return true;
        return argCompatibility(index, at, { file: caller.file, type: caller.type }, p.type, { file: cand.file, type: cand.type }, vars) !== 'mismatch';
      });
    });
    if (!fitsSome) stale.push({ ...call, confidence: 'likely' });
  }
  if (stale.length) ctx.staleCalls.set(id, markChangedCode(ctx, dedupeCallers(stale)));
}

/** Sahip tip ve üst tiplerindeki (yapıcıda yalnız sahip) aynı ad ve arity'deki üyeler. */
function overloadsInHierarchy(ctx: AnalysisContext, owner: string, kind: JavaMember['kind'], name: string, arity: number): ResolvedMember[] {
  const out: ResolvedMember[] = [];
  const seen = new Set<string>();
  const queue = [owner];
  while (queue.length) {
    const fqn = queue.shift() as string;
    if (seen.has(fqn)) continue;
    seen.add(fqn);
    const t = ctx.index.getType(fqn);
    const f = ctx.index.getFileOfType(fqn);
    if (!t || !f) continue;
    for (const m of t.members) if (m.kind === kind && m.name === name && arityMatches(m, arity)) out.push({ member: m, type: t, file: f });
    if (kind === 'constructor') break;
    queue.push(...ctx.index.superTypesOf(fqn));
  }
  return out;
}

function hierarchyHas(ctx: AnalysisContext, owner: string, kind: JavaMember['kind'], name: string, arity: number): boolean {
  const seen = new Set<string>();
  const queue = [owner];
  while (queue.length) {
    const fqn = queue.shift() as string;
    if (seen.has(fqn)) continue;
    seen.add(fqn);
    const t = ctx.index.getType(fqn);
    if (!t) continue;
    if (t.members.some((m) => m.kind === kind && m.name === name && arityMatches(m, arity))) return true;
    if (kind === 'constructor') return false;
    queue.push(...ctx.index.superTypesOf(fqn));
  }
  return false;
}

/** Diff dışındaki (değişmemiş sembollerden gelen) farklı çağıran id'leri. */
export function outsideCallerIds(ctx: AnalysisContext, callers: readonly CallRef[]): string[] {
  const out = new Set<string>();
  for (const c of callers) {
    if (c.inChangedCode) continue;
    const e = ctx.members.get(c.fromId);
    if (e && isSemanticChange(e.md.change.status)) continue;
    out.add(c.fromId);
  }
  return [...out];
}

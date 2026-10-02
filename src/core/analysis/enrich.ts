/**
 * TypeDiff'leri repo indeksiyle zenginleştirir: üst/alt tipler, override ilişkileri, çağıranlar/çağrılanlar,
 * silinmiş/değişmiş ama head'de hâlâ eski haliyle çağrılan üyeler ve kırılan override'lar.
 */
import type { CallRef } from '../../shared/types.js';
import type { JavaMember } from '../java/model.js';
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

/**
 * Doğrudan çağıranlar + override edilen üst tip metotlarının çağıranları (arayüz/port üzerinden polimorfik çağrı).
 * Polimorfik çağrılar 'likely' güvenle eklenir.
 */
function withPolymorphicCallers(ctx: AnalysisContext, id: string, overrides: readonly string[]): CallRef[] {
  const out = ctx.index.callersOf(id);
  const seen = new Set(out.map((c) => `${c.fromId}|${c.file}|${c.line}`));
  for (const sup of overrides) {
    for (const c of ctx.index.callersOf(sup)) {
      const key = `${c.fromId}|${c.file}|${c.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...c, confidence: c.confidence === 'exact' ? 'likely' : c.confidence });
    }
  }
  return out;
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
  if (!relevant) return;
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

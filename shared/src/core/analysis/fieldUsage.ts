/**
 * Silinen / yeniden adlandırılan alan, enum sabiti ve record bileşeni için head'de kalan kullanımların aranması.
 *
 * Alan erişimleri çağrı grafiğinde yer almaz; bu yüzden metin tabanlı (yorumsuz, normalize edilmiş üye metni üzerinde)
 * ad araması yapılır ve bulunan her kullanım 'likely' güvenle bildirilir ("hâlâ kullanılıyor olabilir"):
 *  - statik alan / enum sabiti: sahibi (ya da alt tiplerini) referans eden dosyalarda `Sahip.AD`; enum sabitinde ayrıca
 *    `case AD`; statik import (`import static a.Sahip.AD` doğrudan derleme hatasıdır); sahip tipin (ve iç tiplerinin)
 *    içinde çıplak `AD` (aynı adlı yerel değişkeni olmayan üyelerde) ya da `this.AD`.
 *  - örnek alanı: yalnız sahip tip içinde `this.AD` güvenilir biçimde aranabilir; başka dosyalardaki `x.AD` erişimlerinin
 *    alıcı tipi çözülmez. Bu yüzden kullanım bulunamazsa alan "izlenmiyor" olarak işaretlenir (ctx.untrackedFieldUses).
 *  - record bileşeni: public API'dir (erişimci `ad()` + kanonik yapıcı parametresi). Erişimci çağrıları çağrı grafiğinden
 *    (`findCallsTo`) ve sahibi referans eden dosyalardaki bağlanmamış `.ad()` / `::ad` çağrı yerlerinden aranır.
 *    Bileşen sayısı değişip eski arity'de yapıcı kalmadıysa `new Kayıt(...)` çağrıları bayat yapıcı çağrısıdır.
 */
import type { CallRef } from '../../shared/types.js';
import type { JavaFileModel, JavaMember, JavaType, TypeDiff } from '../java/model.js';
import { escapeRegExp, IDENT, IDENT_AFTER, IDENT_BEFORE } from '../java/names.js';
import { decodeTypeRefPositions } from '../java/typeRefTable.js';
import type { AnalysisContext } from './context.js';
import { dedupeCallers, markChangedCode } from './enrich.js';
import { simpleTypeName } from './util.js';

/** Statik olmayan alan, record sahibinde: record bileşeni. */
export function isRecordComponent(m: Pick<JavaMember, 'kind' | 'modifiers'> | undefined, ownerKind: string | undefined): boolean {
  return !!m && ownerKind === 'record' && m.kind === 'field' && !m.modifiers.includes('static');
}

/** Alan/sabit statik mi (enum sabiti, `static` alan ya da arayüz/annotation sabiti). */
function isStaticField(m: JavaMember, ownerKind: string | undefined): boolean {
  return m.kind === 'enumConstant' || m.modifiers.includes('static') || ownerKind === 'interface' || ownerKind === 'annotation';
}

interface UsageSearch {
  ctx: AnalysisContext;
  owner: string;
  name: string;
  /** Kullanımın sayılacağı dosya filtresi (çift FQN varyantı). */
  mine: (path: string | undefined) => boolean;
  /** Değişen dosya (sahip tipin head dosyası olabilir). */
  path: string;
}

/** Satır: üye aralığındaki ilk `Q` tip referansı (ifade konumu) satırı; bulunamazsa üyenin başlangıç satırı. */
function usageLine(file: JavaFileModel, m: JavaMember, qualifiers: ReadonlySet<string>): number {
  for (const p of decodeTypeRefPositions(file.typeRefPositions)) {
    if (p.line < m.range.startLine) continue;
    if (p.line > m.range.endLine) break;
    if (p.expr && qualifiers.has(simpleTypeName(p.name))) return p.line;
  }
  return m.range.startLine;
}

function typesOfFile(file: JavaFileModel): JavaType[] {
  return file.types;
}

/** Sahip tip (head) ve iç tipleri: kendi dosyasındaki tanımlar. */
function headOwnerTypes(ctx: AnalysisContext, owner: string): { type: JavaType; file: JavaFileModel }[] {
  const entries = ctx.index.typesByFqn(owner);
  const base = entries.length
    ? entries
    : (() => {
        const type = ctx.index.getType(owner);
        const file = ctx.index.getFileOfType(owner);
        return type && file ? [{ type, file }] : [];
      })();
  const out: { type: JavaType; file: JavaFileModel }[] = [];
  for (const { file } of base) {
    for (const t of typesOfFile(file)) if (t.fqn === owner || t.fqn.startsWith(`${owner}.`)) out.push({ type: t, file });
  }
  return out;
}

function push(out: CallRef[], from: JavaMember, file: string, line: number, confidence: CallRef['confidence'] = 'likely'): void {
  out.push({ fromId: from.id, file, line, inChangedCode: false, confidence });
}

/** Statik alan / enum sabiti kullanımları. */
function staticUses(s: UsageSearch, isEnumConstant: boolean): CallRef[] {
  const { ctx, owner, name } = s;
  const out: CallRef[] = [];
  const subs = ctx.index.subTypesOf(owner, true);
  const qualifiers = new Set([simpleTypeName(owner), ...subs.map(simpleTypeName)]);
  const qAlt = [...qualifiers].map(escapeRegExp).join('|');
  const n = escapeRegExp(name);
  const qualified = new RegExp(`${IDENT_BEFORE}(?:${qAlt})\\s*\\.\\s*${n}${IDENT_AFTER}(?!\\s*\\()`, 'u');
  const caseLabel = new RegExp(`${IDENT_BEFORE}case\\s+(?:${IDENT}\\s*,\\s*)*${n}${IDENT_AFTER}`, 'u');
  const bare = new RegExp(`${IDENT_BEFORE}(?<!\\.\\s?)${n}${IDENT_AFTER}(?!\\s*\\()`, 'u');
  const files = new Set<string>();
  for (const f of [owner, ...subs]) for (const p of ctx.index.filesReferencingType(f)) files.add(p);
  for (const p of files) {
    if (!s.mine(p) || ctx.byPath.get(p)?.cs.status === 'deleted') continue;
    const file = ctx.index.files.get(p);
    if (!file) continue;
    const imp = file.imports.find((i) => i.static && !i.wildcard && i.name === `${owner}.${name}`);
    const wildStatic = file.imports.some((i) => i.static && i.wildcard && i.name === owner);
    let found = false;
    for (const t of file.types) {
      for (const m of t.members) {
        const text = m.normalizedText;
        if (!text.includes(name)) continue;
        if (qualified.test(text)) push(out, m, p, usageLine(file, m, qualifiers));
        else if (isEnumConstant && caseLabel.test(text)) push(out, m, p, m.range.startLine);
        else if ((imp || wildStatic) && !(name in m.localTypes) && bare.test(text)) push(out, m, p, m.range.startLine);
        else continue;
        found = true;
      }
    }
    // Statik import'un kendisi derlenmez: üyede kullanım bulunmasa da import satırı bildirilir.
    if (imp && !found) out.push({ fromId: file.types[0] ? `${file.types[0].fqn}` : p, file: p, line: imp.line, inChangedCode: false, confidence: 'likely' });
  }
  for (const { type, file } of headOwnerTypes(ctx, owner)) {
    if (!s.mine(file.path)) continue;
    for (const m of type.members) {
      if (!m.normalizedText.includes(name) || m.name === name) continue;
      if (name in m.localTypes) continue;
      if (bare.test(m.normalizedText) || qualified.test(m.normalizedText)) push(out, m, file.path, m.range.startLine);
    }
  }
  return out;
}

/** Örnek alanı: yalnız sahip tip içinde `this.AD` (güvenilir). */
function instanceUses(s: UsageSearch): CallRef[] {
  const out: CallRef[] = [];
  const re = new RegExp(`${IDENT_BEFORE}this\\s*\\.\\s*${escapeRegExp(s.name)}${IDENT_AFTER}(?!\\s*\\()`, 'u');
  for (const { type, file } of headOwnerTypes(s.ctx, s.owner)) {
    if (type.fqn !== s.owner || !s.mine(file.path)) continue;
    for (const m of type.members) if (m.normalizedText.includes(s.name) && re.test(m.normalizedText)) push(out, m, file.path, m.range.startLine);
  }
  return out;
}

/** Head hiyerarşisinde `name()` metodu (açık erişimci ya da kalıtılan) var mı. */
function hasAccessor(ctx: AnalysisContext, owner: string, name: string): boolean {
  const seen = new Set<string>();
  const queue = [owner];
  while (queue.length) {
    const fqn = queue.shift() as string;
    if (seen.has(fqn)) continue;
    seen.add(fqn);
    const t = ctx.index.getType(fqn);
    if (t?.members.some((m) => m.kind === 'method' && m.name === name && m.params.length === 0)) return true;
    if (t?.kind === 'record' && t.members.some((m) => isRecordComponent(m, 'record') && m.name === name)) return true;
    queue.push(...ctx.index.superTypesOf(fqn));
  }
  return false;
}

/** Record erişimcisi `ad()` / `::ad` çağrıları. */
function accessorUses(s: UsageSearch): CallRef[] {
  const { ctx, owner, name } = s;
  if (hasAccessor(ctx, owner, name)) return [];
  const out: CallRef[] = [];
  const seen = new Set<string>();
  for (const c of ctx.index.findCallsTo(owner, name, 0)) {
    if (c.confidence === 'name-only' || !ctx.index.files.has(c.file) || !s.mine(c.file)) continue;
    seen.add(`${c.fromId}|${c.line}`);
    out.push(c);
  }
  const files = new Set(ctx.index.filesReferencingType(owner));
  for (const { file } of headOwnerTypes(ctx, owner)) files.add(file.path);
  for (const p of files) {
    if (!s.mine(p)) continue;
    const file = ctx.index.files.get(p);
    if (!file) continue;
    for (const t of file.types) {
      for (const m of t.members) {
        for (const site of m.callSites) {
          if (site.isConstructor || site.name !== name || (site.argCount !== 0 && !site.isMethodRef)) continue;
          if (seen.has(`${m.id}|${site.line}`)) continue;
          if (ctx.index.targetsOfCallSite(m.id, site.line, name).length > 0) continue;
          seen.add(`${m.id}|${site.line}`);
          push(out, m, p, site.line);
        }
      }
    }
  }
  return out;
}

function store(ctx: AnalysisContext, id: string, calls: CallRef[]): void {
  if (calls.length === 0) return;
  const prev = ctx.staleCalls.get(id) ?? [];
  const marked = markChangedCode(ctx, dedupeCallers(calls)).map((c) => ({ ...c, fromId: ctx.ids.toModel(c.fromId, c.file) }));
  ctx.staleCalls.set(id, dedupeCallers([...prev, ...marked]));
}

/**
 * Silinen/yeniden adlandırılan/taşınan alan, enum sabiti ya da record bileşeni için head'de kalan kullanımlar
 * (ctx.staleCalls'a 'likely' güvenle eklenir). Örnek alanında kullanım bulunamazsa ctx.untrackedFieldUses işaretlenir.
 */
export function findStaleFieldUses(
  ctx: AnalysisContext,
  td: TypeDiff,
  id: string,
  status: string,
  oldM: JavaMember,
  path: string,
  mine: (path: string | undefined) => boolean,
): void {
  if (oldM.kind !== 'field' && oldM.kind !== 'enumConstant') return;
  if (status !== 'removed' && status !== 'renamed' && status !== 'moved') return;
  const owner = oldM.ownerFqn;
  const ownerKind = td.oldType?.kind ?? td.change.kind;
  // Head sahibinde aynı adlı alan kaldıysa (ör. üst tipe taşındı) kullanım geçerlidir.
  const head = ctx.index.getType(owner);
  if (head && (head.fieldTypes[oldM.name] !== undefined || head.members.some((m) => (m.kind === 'field' || m.kind === 'enumConstant') && m.name === oldM.name))) return;
  const s: UsageSearch = { ctx, owner, name: oldM.name, mine, path };
  if (isRecordComponent(oldM, ownerKind)) {
    store(ctx, id, accessorUses(s));
    return;
  }
  if (isStaticField(oldM, ownerKind)) {
    store(ctx, id, staticUses(s, oldM.kind === 'enumConstant'));
    return;
  }
  const uses = instanceUses(s);
  store(ctx, id, uses);
  if (uses.length === 0) {
    ctx.untrackedFieldUses ??= new Set();
    ctx.untrackedFieldUses.add(id);
  }
}

function canonicalArity(t: JavaType | undefined): number {
  return t ? t.members.filter((m) => isRecordComponent(m, t.kind)).length : 0;
}

function ctorArityMatches(m: JavaMember, n: number): boolean {
  if (m.params.length === n) return true;
  const last = m.params[m.params.length - 1];
  return !!last?.varargs && n >= m.params.length - 1;
}

/**
 * Record bileşen sayısı değişti ve eski kanonik yapıcı örtüktü: head'de eski arity'de yapıcı kalmadıysa `new Kayıt(...)`
 * çağrıları bayat yapıcı çağrısıdır. Çağrılar ilk silinen (yoksa ilk eklenen) bileşene bağlanır.
 * (Açık kanonik/compact yapıcı varsa yapıcı üyesinin kendisi bayat çağrı aramasından geçer.)
 */
export function findStaleRecordConstructorCalls(ctx: AnalysisContext, td: TypeDiff, mine: (path: string | undefined) => boolean): void {
  const ot = td.oldType;
  const nt = td.newType;
  if (!ot || !nt || ot.kind !== 'record' || nt.kind !== 'record') return;
  const oldArity = canonicalArity(ot);
  const newArity = canonicalArity(nt);
  if (oldArity === newArity) return;
  if (ot.members.some((m) => m.kind === 'constructor' && m.params.length === oldArity)) return;
  if (nt.members.some((m) => m.kind === 'constructor' && ctorArityMatches(m, oldArity))) return;
  const target =
    td.members.find((md) => md.change.status === 'removed' && isRecordComponent(md.oldMember, 'record')) ??
    td.members.find((md) => md.change.status === 'added' && isRecordComponent(md.newMember, 'record'));
  if (!target) return;
  const calls = ctx.index
    .findCallsTo(nt.fqn, nt.name, oldArity)
    .filter((c) => c.confidence !== 'name-only' && ctx.index.files.has(c.file) && mine(c.file));
  store(ctx, target.change.id, calls);
}

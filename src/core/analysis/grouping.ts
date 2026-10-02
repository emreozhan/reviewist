/**
 * Değişen semboller arasında bağlı bileşenler (union-find) → ChangeGroup ("hikâyeler").
 *
 * Kenarlar:
 *  - aynı tip içi: aynı tipteki değişen üyeler birlikte
 *  - override: implementasyon ↔ sözleşme metodu
 *  - extends/implements: değişen alt tip ↔ değişen üst tip
 *  - calls: yalnızca çağrılanın API'si değiştiyse (imza/ad/silme/taşıma/ekleme). Gövdesi değişen bir metodu çağıran,
 *    o değişiklik yüzünden değişmiş sayılmaz; aksi halde büyük diff'lerde her şey tek gruba çöker.
 * Tek elemanlı düşük/orta riskli bileşenler "Diğer küçük değişiklikler", kozmetikler "Biçimsel değişiklikler" grubunda toplanır.
 */
import type { CallRef, ChangeGroup, FileChange, MemberChange, RiskInfo, RiskLevel } from '../../shared/types.js';
import type { TypeDiff } from '../java/model.js';
import { isBreakingSignature, isSemanticChange } from './risk.js';
import { maxLevel, RISK_LEVEL_ORDER, symbolLabel } from './util.js';

class UnionFind {
  private readonly parent = new Map<string, string>();
  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x: string): string {
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r) as string;
    let c = x;
    while (c !== r) {
      const n = this.parent.get(c) as string;
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(a: string, b: string): void {
    if (!this.parent.has(a) || !this.parent.has(b)) return;
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
}

interface Sym {
  id: string;
  typeId: string;
  file: string;
  td: TypeDiff;
  mc?: MemberChange;
  risk: RiskInfo;
  isTest: boolean;
}

/** Çağıranların da değişmesine yol açan (API düzeyi) değişiklik mi. */
function isApiChange(mc: MemberChange): boolean {
  return isBreakingSignature(mc) || mc.status === 'removed' || mc.status === 'renamed' || mc.status === 'moved' || mc.status === 'added';
}

/** Çapa önceliği: kök neden (imza/ad/silme/taşıma) > sözleşme tipi > risk. */
function anchorRank(s: Sym): number[] {
  const root = s.mc ? (isBreakingSignature(s.mc) || ['removed', 'renamed', 'moved'].includes(s.mc.status) ? 1 : 0) : 0;
  const contract = s.td.change.kind === 'interface' || s.td.newType?.modifiers.includes('abstract') ? 1 : 0;
  return [s.isTest ? 0 : 1, root, contract, s.risk.score];
}

function compareRank(a: Sym, b: Sym): number {
  const ra = anchorRank(a);
  const rb = anchorRank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
  return a.id.localeCompare(b.id);
}

function verbOf(mc: MemberChange): string {
  if (mc.status === 'signatureChanged') return isBreakingSignature(mc) ? 'imza değişikliği' : 'anotasyon değişikliği';
  if (mc.status === 'removed') return 'kaldırıldı';
  if (mc.status === 'moved') return 'taşındı';
  if (mc.status === 'added') return 'eklendi';
  if (mc.status === 'renamed') return `→ ${mc.name} yeniden adlandırıldı`;
  return 'davranış değişikliği';
}

function groupTitle(anchor: Sym, symbols: Sym[], tdById: Map<string, TypeDiff>, staleCalls: ReadonlyMap<string, readonly CallRef[]>): string {
  // Bileşen tek bir tipin tamamen eklenmesi/silinmesiyse tip düzeyinde başlık
  const typeIds = new Set(symbols.map((s) => s.typeId));
  const td = tdById.get(anchor.typeId) ?? anchor.td;
  if (typeIds.size === 1 && (td.change.status === 'added' || td.change.status === 'removed')) {
    const kindTr = td.change.kind === 'interface' ? 'arayüzü' : 'sınıfı';
    return `${td.change.name} ${kindTr} ${td.change.status === 'added' ? 'eklendi' : 'kaldırıldı'} (${symbols.length} üye)`;
  }
  if (!anchor.mc) {
    const ch = anchor.td.change;
    const verb = ch.status === 'renamed' || ch.status === 'moved' ? 'tipi taşındı/yeniden adlandırıldı' : 'tipi değişti';
    const parts: string[] = [];
    if (ch.subTypes.length) parts.push(`${ch.subTypes.length} ${ch.kind === 'interface' ? 'implementasyon' : 'alt sınıf'}`);
    if (symbols.length > 1) parts.push(`${symbols.length - 1} ilişkili değişiklik`);
    return `${ch.name} ${verb}${parts.length ? ` → ${parts.join(', ')}` : ''}`;
  }
  const mc = anchor.mc;
  const owner = tdById.get(mc.ownerTypeId)?.change ?? anchor.td.change;
  const label = mc.status === 'renamed' && mc.oldName ? `${owner.name}.${mc.oldName}` : symbolLabel(mc.id);
  const ownerIsContract = owner.kind === 'interface' || anchor.td.newType?.modifiers.includes('abstract') === true;
  const implCount = Math.max(mc.overriddenBy.length, ownerIsContract && mc.kind === 'method' ? owner.subTypes.length : 0);
  const callers = new Set(mc.callers.map((c) => c.fromId)).size;
  const broken = staleCalls.get(mc.id)?.length ?? 0;
  const parts: string[] = [];
  if (broken) parts.push(`${broken} kırık çağrı`);
  if (implCount) parts.push(`${implCount} ${owner.kind === 'interface' ? 'implementasyon' : 'alt sınıf'}`);
  if (callers) parts.push(`${callers} çağıran`);
  const others = symbols.length - 1;
  const suffix = others > 0 ? ` (+${others} ilişkili değişiklik)` : '';
  return `${label} ${verbOf(mc)}${parts.length ? ` → ${parts.join(', ')}` : ''}${suffix}`;
}

function describe(symbols: Sym[], files: string[]): string {
  const labels = symbols.slice(0, 6).map((s) => `${symbolLabel(s.id)} (${s.mc?.status ?? s.td.change.status})`);
  return `${symbols.length} değişen sembol, ${files.length} dosya: ${labels.join(', ')}${symbols.length > 6 ? ` ve ${symbols.length - 6} sembol daha` : ''}.`;
}

/** Grupları üretir ve MemberChange.groupId alanlarını doldurur. */
export function buildGroups(typeDiffs: readonly TypeDiff[], files: readonly FileChange[], staleCalls: ReadonlyMap<string, readonly CallRef[]> = new Map()): ChangeGroup[] {
  const syms = new Map<string, Sym>();
  const cosmetic = new Map<string, Sym>();
  const tdById = new Map<string, TypeDiff>();
  const typeRep = new Map<string, string>();
  const cosmeticFiles = new Set(files.filter((f) => f.cosmeticOnly).map((f) => f.path));
  const testFiles = new Set(files.filter((f) => f.isTest).map((f) => f.path));

  for (const td of typeDiffs) {
    const ch = td.change;
    if (!tdById.has(ch.id) || td.newType) tdById.set(ch.id, td);
    const inCosmeticFile = cosmeticFiles.has(ch.file);
    const isTest = testFiles.has(ch.file);
    let any = false;
    for (const md of td.members) {
      const mc = md.change;
      if (isSemanticChange(mc.status) && !inCosmeticFile) {
        if (!syms.has(mc.id)) syms.set(mc.id, { id: mc.id, typeId: ch.id, file: ch.file, td, mc, risk: mc.risk, isTest });
        any = true;
      } else if (mc.status === 'cosmetic' || (inCosmeticFile && mc.status !== 'unchanged')) {
        cosmetic.set(mc.id, { id: mc.id, typeId: ch.id, file: ch.file, td, mc, risk: mc.risk, isTest });
      }
    }
    if (!any && isSemanticChange(ch.status) && !inCosmeticFile && !syms.has(ch.id)) {
      syms.set(ch.id, { id: ch.id, typeId: ch.id, file: ch.file, td, risk: ch.risk, isTest });
    }
  }

  const uf = new UnionFind();
  for (const s of syms.values()) {
    uf.add(s.id);
    const rep = typeRep.get(s.typeId);
    if (rep) uf.union(rep, s.id);
    else typeRep.set(s.typeId, s.id);
  }
  // Üretim kodu kenarları. Test sembolleri köprü olmaz: bir test birden çok hikâyeyi çağırsa da onları birleştirmemeli.
  const prodEdge = (a: string, b: string) => {
    if (syms.get(a)?.isTest || syms.get(b)?.isTest) return;
    uf.union(a, b);
  };
  for (const s of syms.values()) {
    if (!s.mc) continue;
    for (const c of s.mc.callees) {
      const callee = syms.get(c);
      if (callee?.mc && isApiChange(callee.mc)) prodEdge(s.id, c);
    }
    if (isApiChange(s.mc)) for (const c of s.mc.callers) if (syms.has(c.fromId)) prodEdge(s.id, c.fromId);
    for (const o of s.mc.overrides) if (syms.has(o)) prodEdge(s.id, o);
    for (const o of s.mc.overriddenBy) if (syms.has(o)) prodEdge(s.id, o);
  }
  for (const td of tdById.values()) {
    const rep = typeRep.get(td.change.id);
    if (!rep) continue;
    for (const sup of td.change.superTypes) {
      const other = typeRep.get(sup);
      if (other) prodEdge(rep, other);
    }
  }
  // Test tipleri, çağırdıkları en riskli değişen üretim sembolünün grubuna eklenir (tek bağlantı).
  const testTypes = new Map<string, Sym[]>();
  for (const s of syms.values()) {
    if (!s.isTest) continue;
    const list = testTypes.get(s.typeId);
    if (list) list.push(s);
    else testTypes.set(s.typeId, [s]);
  }
  const prodByTypeName = new Map<string, Sym>();
  for (const s of syms.values()) if (!s.isTest && !prodByTypeName.has(s.td.change.name)) prodByTypeName.set(s.td.change.name, s);
  for (const list of testTypes.values()) {
    // Önce ad kalıbı (FooTest → Foo), yoksa çağırdığı en riskli üretim sembolü
    const subject = /^(?:Test(?=[A-Z]))?(\w+?)(?:Test|Tests|IT|ITCase|IntegrationTest|Spec)?$/.exec(list[0].td.change.name)?.[1];
    let best: Sym | undefined = subject ? prodByTypeName.get(subject) : undefined;
    for (const s of best ? [] : list) {
      for (const c of s.mc?.callees ?? []) {
        const target = syms.get(c);
        if (target && !target.isTest && (!best || target.risk.score > best.risk.score)) best = target;
      }
    }
    if (best) uf.union(list[0].id, best.id);
  }

  const comps = new Map<string, Sym[]>();
  for (const s of syms.values()) {
    const r = uf.find(s.id);
    const list = comps.get(r);
    if (list) list.push(s);
    else comps.set(r, [s]);
  }

  const groups: (ChangeGroup & { score: number })[] = [];
  const small: Sym[] = [];
  for (const symbols of comps.values()) {
    symbols.sort((a, b) => b.risk.score - a.risk.score || a.id.localeCompare(b.id));
    const level = maxLevel(symbols.map((s) => s.risk.level));
    if (symbols.length === 1 && RISK_LEVEL_ORDER[level] < RISK_LEVEL_ORDER.high) {
      small.push(symbols[0]);
      continue;
    }
    const anchor = [...symbols].sort(compareRank)[0];
    const fileIds = [...new Set(symbols.map((s) => s.file))].sort();
    groups.push({
      id: `group:${anchor.id}`,
      title: groupTitle(anchor, symbols, tdById, staleCalls),
      description: describe(symbols, fileIds),
      symbolIds: symbols.map((s) => s.id),
      fileIds,
      riskLevel: level,
      score: symbols[0].risk.score,
    });
  }
  groups.sort((a, b) => RISK_LEVEL_ORDER[b.riskLevel] - RISK_LEVEL_ORDER[a.riskLevel] || b.score - a.score || b.symbolIds.length - a.symbolIds.length || a.title.localeCompare(b.title));
  const out: ChangeGroup[] = groups.map(({ score: _score, ...g }) => g);

  if (small.length) {
    small.sort((a, b) => b.risk.score - a.risk.score || a.id.localeCompare(b.id));
    const fileIds = [...new Set(small.map((s) => s.file))].sort();
    out.push({
      id: 'group:small',
      title: 'Diğer küçük değişiklikler',
      description: `Birbirine bağlı olmayan ${small.length} küçük değişiklik (${fileIds.length} dosya): ${small.slice(0, 6).map((s) => symbolLabel(s.id)).join(', ')}${small.length > 6 ? ' ...' : ''}.`,
      symbolIds: small.map((s) => s.id),
      fileIds,
      riskLevel: maxLevel(small.map((s) => s.risk.level)),
    });
  }
  const javaFilesWithTypes = new Set(typeDiffs.map((td) => td.change.file));
  const otherFiles = files.filter((f) => !f.cosmeticOnly && !javaFilesWithTypes.has(f.path));
  if (otherFiles.length) {
    const levels: RiskLevel[] = otherFiles.map((f) => f.risk.level);
    const paths = otherFiles.map((f) => f.path).sort();
    out.push({
      id: 'group:files',
      title: 'Yapılandırma, build ve diğer dosyalar',
      description: `Sembol düzeyinde analiz edilmeyen ${paths.length} dosya: ${paths.slice(0, 6).join(', ')}${paths.length > 6 ? ' ...' : ''}.`,
      symbolIds: [],
      fileIds: paths,
      riskLevel: maxLevel(levels),
    });
  }
  if (cosmetic.size || cosmeticFiles.size) {
    const fileIds = [...new Set([...[...cosmetic.values()].map((s) => s.file), ...cosmeticFiles])].sort();
    out.push({
      id: 'group:cosmetic',
      title: 'Biçimsel değişiklikler',
      description: `Yalnızca biçim/yorum/import değişikliği: ${cosmetic.size} sembol, ${fileIds.length} dosya. Hızlıca geçilebilir.`,
      symbolIds: [...cosmetic.keys()],
      fileIds,
      riskLevel: 'low',
    });
  }

  for (const g of out) {
    for (const id of g.symbolIds) {
      const s = syms.get(id) ?? cosmetic.get(id);
      if (s?.mc) s.mc.groupId = g.id;
    }
  }
  return out;
}

/**
 * Değişen semboller arasında bağlı bileşenler (union-find) → ChangeGroup ("hikâyeler").
 *
 * Kenarlar:
 *  - aynı tip içi: aynı tipteki değişen üyeler birlikte
 *  - override: implementasyon ↔ sözleşme metodu
 *  - extends/implements: değişen alt tip ↔ değişen üst tip
 *  - calls: yalnızca çağrılanın API'si değiştiyse (imza/ad/silme/taşıma/ekleme). Gövdesi değişen bir metodu çağıran,
 *    o değişiklik yüzünden değişmiş sayılmaz; aksi halde büyük diff'lerde her şey tek gruba çöker.
 *  - taşıma: taşınan üye (status 'moved') ile eski sahibinin üyeleri arasındaki kenarlar (eski sahibin taşınan metodu
 *    çağırması gibi) birleştirici sayılmaz; taşıma kendi hikâyesi olur ("validate PlaceOrderService → OrderValidator taşındı").
 * Test sembolleri köprü olmaz; her test tipi ilgili tek bir üretim hikâyesine bağlanır ve grubun sonunda listelenir.
 * Hub semboller (equals/hashCode/toString/compareTo ya da ≥ HUB_DEGREE farklı tipten komşusu olanlar) tipler arası köprü
 * olmaz; yalnız kendi tipinin hikâyesinde kalır. MAX_GROUP_SYMBOLS'u aşan bileşenler paket bazında (gerekirse paket
 * içinde tip sınırında) bölünür; başlıkta paket ve bölüm belirtilir.
 * Tek elemanlı düşük/orta riskli bileşenler "Diğer küçük değişiklikler", kozmetikler "Biçimsel değişiklikler" grubunda toplanır.
 */
import type { CallRef, ChangeGroup, FileChange, MemberChange, RiskInfo, RiskLevel } from '../../shared/types.js';
import type { TypeDiff } from '../java/model.js';
import { TEST_STEM_PATTERN } from '../java/names.js';
import { isBreakingSignature, isSemanticChange } from './risk.js';
import { maxLevel, RISK_LEVEL_ORDER, simpleTypeName, symbolLabel } from './util.js';
import { compareStrings } from '../compare.js';

export const MAX_GROUP_SYMBOLS = 40;
export const HUB_DEGREE = 15;
const HUB_NAMES = new Set(['equals', 'hashCode', 'toString', 'compareTo']);

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
  return compareStrings(a.id, b.id);
}

/** Taşınan üyenin eski sahibi (tip id'si); taşıma değilse undefined. */
function movedFrom(mc: MemberChange | undefined): string | undefined {
  if (mc?.status !== 'moved' || !mc.oldId) return undefined;
  const i = mc.oldId.indexOf('#');
  const owner = i >= 0 ? mc.oldId.slice(0, i) : undefined;
  return owner && owner !== mc.ownerTypeId ? owner : undefined;
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
  const from = movedFrom(mc);
  let label = mc.status === 'renamed' && mc.oldName ? `${owner.name}.${mc.oldName}` : symbolLabel(mc.id);
  if (from) {
    const fromName = simpleTypeName(from);
    label = fromName === owner.name ? `${mc.name} ${from} → ${owner.id}` : `${mc.name} ${fromName} → ${owner.name}`;
  }
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

function packageOfSym(s: Sym): string {
  return (s.td.newFile ?? s.td.oldFile)?.packageName ?? '';
}

/**
 * MAX_GROUP_SYMBOLS'u aşan bileşeni paket bazında böler; paket parçası da büyükse tip sınırında sıralı parçalara ayırır
 * (sınırı tek başına aşan tipin üyeleri riske göre dilimlenir). Küçük bileşen tek parça döner (part undefined).
 */
function splitComponent(symbols: Sym[]): { symbols: Sym[]; part?: string }[] {
  if (symbols.length <= MAX_GROUP_SYMBOLS) return [{ symbols }];
  const byPkg = new Map<string, Sym[]>();
  for (const s of symbols) {
    const pkg = packageOfSym(s);
    const list = byPkg.get(pkg);
    if (list) list.push(s);
    else byPkg.set(pkg, [s]);
  }
  const out: { symbols: Sym[]; part?: string }[] = [];
  const pkgs = [...byPkg.keys()].sort();
  for (const pkg of pkgs) {
    const list = byPkg.get(pkg) as Sym[];
    const label = pkg ? `paket ${pkg}` : 'varsayılan paket';
    if (list.length <= MAX_GROUP_SYMBOLS) {
      out.push({ symbols: list, part: label });
      continue;
    }
    // Tip sınırında parçalara ayır (tipin üyeleri birlikte kalır)
    const byType = new Map<string, Sym[]>();
    for (const s of list) {
      const t = byType.get(s.typeId);
      if (t) t.push(s);
      else byType.set(s.typeId, [s]);
    }
    const chunks: Sym[][] = [];
    let cur: Sym[] = [];
    for (const typeId of [...byType.keys()].sort()) {
      const members = byType.get(typeId) as Sym[];
      if (cur.length > 0 && cur.length + members.length > MAX_GROUP_SYMBOLS) {
        chunks.push(cur);
        cur = [];
      }
      // Tek tip sınırı aşıyorsa üyeleri (riske göre sıralı) dilimlenir.
      if (members.length > MAX_GROUP_SYMBOLS) {
        const sorted = [...members].sort((x, y) => y.risk.score - x.risk.score || compareStrings(x.id, y.id));
        for (let i = 0; i < sorted.length; i += MAX_GROUP_SYMBOLS) chunks.push(sorted.slice(i, i + MAX_GROUP_SYMBOLS));
        continue;
      }
      cur.push(...members);
    }
    if (cur.length) chunks.push(cur);
    chunks.forEach((c, i) => out.push({ symbols: c, part: chunks.length > 1 ? `${label}, bölüm ${i + 1}/${chunks.length}` : label }));
  }
  return out;
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
  // Taşınan üye ile eski sahibinin üyeleri arasındaki kenar da birleştirmez (taşıma ayrı hikâye).
  const isMoveEdge = (x: Sym | undefined, y: Sym | undefined) => {
    const from = movedFrom(x?.mc);
    return from !== undefined && y?.typeId === from;
  };
  type EdgeKind = 'call' | 'override' | 'type';
  const edges: [string, string, EdgeKind][] = [];
  const neighbors = new Map<string, Set<string>>();
  const prodEdge = (a: string, b: string, kind: EdgeKind) => {
    const sa = syms.get(a);
    const sb = syms.get(b);
    if (!sa || !sb || a === b) return;
    if (sa.isTest || sb.isTest) return;
    if (isMoveEdge(sa, sb) || isMoveEdge(sb, sa)) return;
    edges.push([a, b, kind]);
    if (sa.typeId === sb.typeId || kind !== 'call') return;
    for (const [x, y] of [[a, sb.typeId], [b, sa.typeId]] as const) {
      const set = neighbors.get(x);
      if (set) set.add(y);
      else neighbors.set(x, new Set([y]));
    }
  };
  for (const s of syms.values()) {
    if (!s.mc) continue;
    for (const c of s.mc.callees) {
      const callee = syms.get(c);
      if (callee?.mc && isApiChange(callee.mc)) prodEdge(s.id, c, 'call');
    }
    if (isApiChange(s.mc)) for (const c of s.mc.callers) if (syms.has(c.fromId)) prodEdge(s.id, c.fromId, 'call');
    for (const o of s.mc.overrides) if (syms.has(o)) prodEdge(s.id, o, 'override');
    for (const o of s.mc.overriddenBy) if (syms.has(o)) prodEdge(s.id, o, 'override');
  }
  for (const td of tdById.values()) {
    const rep = typeRep.get(td.change.id);
    if (!rep) continue;
    for (const sup of td.change.superTypes) {
      const other = typeRep.get(sup);
      if (other) prodEdge(rep, other, 'type');
    }
  }
  // Hub semboller köprü olmaz: equals/hashCode/toString/compareTo hiçbir tipler arası kenarda; çok çağrılan/çağıran
  // (≥ HUB_DEGREE farklı tipte komşu) semboller çağrı kenarlarında birleştirmez. Override (sözleşme → implementasyon)
  // ve tip düzeyi kalıtım kenarları gerçek hikâyedir; büyürse boyut sınırıyla bölünür.
  const nameHub = (id: string) => {
    const name = syms.get(id)?.mc?.name;
    return name !== undefined && HUB_NAMES.has(name);
  };
  const degreeHub = (id: string) => (neighbors.get(id)?.size ?? 0) >= HUB_DEGREE;
  for (const [a, b, kind] of edges) {
    const crossType = syms.get(a)?.typeId !== syms.get(b)?.typeId;
    if (crossType && kind !== 'type' && (nameHub(a) || nameHub(b))) continue;
    if (crossType && kind === 'call' && (degreeHub(a) || degreeHub(b))) continue;
    uf.union(a, b);
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
    const subject = TEST_STEM_PATTERN.exec(list[0].td.change.name)?.[1];
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
  for (const component of comps.values()) {
    for (const { symbols, part } of splitComponent(component)) {
      // Üretim sembolleri önce (riske göre), testler sonda.
      symbols.sort((a, b) => Number(a.isTest) - Number(b.isTest) || b.risk.score - a.risk.score || compareStrings(a.id, b.id));
      const level = maxLevel(symbols.map((s) => s.risk.level));
      if (symbols.length === 1 && RISK_LEVEL_ORDER[level] < RISK_LEVEL_ORDER.high) {
        small.push(symbols[0]);
        continue;
      }
      const anchor = [...symbols].sort(compareRank)[0];
      const fileIds = [...new Set(symbols.map((s) => s.file))].sort();
      const title = groupTitle(anchor, symbols, tdById, staleCalls);
      groups.push({
        id: `group:${anchor.id}`,
        title: part ? `${title} — ${part}` : title,
        description: part ? `${describe(symbols, fileIds)} Büyük hikâye (${component.length} sembol) ${MAX_GROUP_SYMBOLS} sembollük parçalara bölündü: ${part}.` : describe(symbols, fileIds),
        symbolIds: symbols.map((s) => s.id),
        fileIds,
        riskLevel: level,
        score: Math.max(...symbols.map((s) => s.risk.score)),
      });
    }
  }
  groups.sort((a, b) => RISK_LEVEL_ORDER[b.riskLevel] - RISK_LEVEL_ORDER[a.riskLevel] || b.score - a.score || b.symbolIds.length - a.symbolIds.length || compareStrings(a.title, b.title));
  const out: ChangeGroup[] = groups.map(({ score: _score, ...g }) => g);

  if (small.length) {
    small.sort((a, b) => b.risk.score - a.risk.score || compareStrings(a.id, b.id));
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

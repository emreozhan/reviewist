import type {
  ChangeGroup,
  FileChange,
  Finding,
  FindingCategory,
  ImpactNode,
  MemberChange,
  ReviewModel,
  ReviewStep,
  TypeChange,
} from '../../../src/shared/types';
import { fileFingerprint } from './fingerprint';
import { memberName, parseSymbolId, simpleTypeName } from './symbolId';

export interface PlanEntry {
  file: FileChange;
  step: ReviewStep | null;
  /** Okuma planındaki sıra (1 tabanlı). */
  order: number;
}

export type Severity = Finding['severity'];
export type SeverityCounts = Record<Severity, number>;

/** Paket öneki → kaynak kökü (ör. 'com/acme/' → 'src/main/java/'); diff dışı dosya yolu tahmini için. */
export interface SourceRoot {
  pkg: string;
  root: string;
}

/** ReviewModel üzerinde hızlı arama için bir kez (O(n)) kurulan haritalar. Render sırasında modeli taramaya gerek kalmaz. */
export interface ReviewIndex {
  fileById: Map<string, FileChange>;
  typeById: Map<string, TypeChange>;
  memberById: Map<string, MemberChange>;
  /** Sembol (tip veya üye) → dosya yolu (yalnız diff içindekiler). */
  symbolFile: Map<string, string>;
  nodeById: Map<string, ImpactNode>;
  stepByFile: Map<string, ReviewStep>;
  findingsBySymbol: Map<string, Finding[]>;
  findingsByFile: Map<string, Finding[]>;
  groupsBySymbol: Map<string, ChangeGroup[]>;
  /** Taşınan/yeniden adlandırılan üyelerin eski kimliği → yeni üye. */
  membersByOldId: Map<string, MemberChange[]>;
  /** Plan sırası: önce plan adımları, sonra plana girmemiş dosyalar (reviewOrder'a göre). */
  planEntries: PlanEntry[];
  /** Dosya ya da içindeki bir tip/üye yüksek/kritik riskli. */
  highRiskFiles: Set<string>;
  /** Arama için küçük harfli metin: yol + tip adları + üye adları (eski adlar dahil). */
  searchText: Map<string, string>;
  /** Diff dışı sembol → onu etkileyen diff içi sembol (çağırdığı, override ettiği, alt tipi olduğu). */
  anchorByOutside: Map<string, string>;
  sourceRoots: SourceRoot[];
  /** Riske, sonra sembol sayısına göre sıralı gruplar. */
  groupsByRisk: ChangeGroup[];
  findingCounts: { total: SeverityCounts; byCategory: Map<FindingCategory, SeverityCounts> };
  /** Dosya id → değişiklik parmak izi ("görüldü" işaretinin bayatlığını anlamak için; bir kez hesaplanır). */
  fingerprintByFile: Map<string, string>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function setIfAbsent<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key)) map.set(key, value);
}

const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const;
const isHigh = (level: keyof typeof RISK_ORDER) => level === 'high' || level === 'critical';

export const emptySeverityCounts = (): SeverityCounts => ({ error: 0, warning: 0, info: 0 });

function buildPlanEntries(review: ReviewModel, fileById: Map<string, FileChange>): PlanEntry[] {
  const entries: PlanEntry[] = [];
  const seen = new Set<string>();
  for (const step of [...review.reviewPlan].sort((a, b) => a.order - b.order)) {
    const file = fileById.get(step.fileId);
    if (!file || seen.has(file.id)) continue;
    seen.add(file.id);
    entries.push({ file, step, order: entries.length + 1 });
  }
  const rest = review.files.filter((f) => !seen.has(f.id)).sort((a, b) => a.reviewOrder - b.reviewOrder);
  for (const file of rest) entries.push({ file, step: null, order: entries.length + 1 });
  return entries;
}

function buildSourceRoots(types: readonly TypeChange[]): SourceRoot[] {
  const seen = new Set<string>();
  const out: SourceRoot[] = [];
  for (const t of types) {
    const top = topLevelFqn(t.id);
    const suffix = `${top.replace(/\./g, '/')}.java`;
    if (!t.file.endsWith(suffix)) continue;
    const root = t.file.slice(0, t.file.length - suffix.length);
    const pkg = top.slice(0, top.lastIndexOf('.') + 1);
    const key = `${root}|${pkg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pkg, root });
  }
  return out;
}

export function buildIndex(review: ReviewModel): ReviewIndex {
  const fileById = new Map(review.files.map((f) => [f.id, f]));
  const typeById = new Map(review.types.map((t) => [t.id, t]));
  const memberById = new Map<string, MemberChange>();
  const symbolFile = new Map<string, string>();
  const membersByOldId = new Map<string, MemberChange[]>();
  const highRiskFiles = new Set<string>();
  const typeSearch = new Map<string, string[]>();
  const anchorByOutside = new Map<string, string>();

  for (const f of review.files) if (isHigh(f.risk.level)) highRiskFiles.add(f.id);
  for (const t of review.types) {
    symbolFile.set(t.id, t.file);
    if (isHigh(t.risk.level)) highRiskFiles.add(t.file);
    const words = [t.name.toLowerCase()];
    for (const m of t.members) {
      memberById.set(m.id, m);
      symbolFile.set(m.id, t.file);
      if (m.oldId && m.oldId !== m.id) push(membersByOldId, m.oldId, m);
      if (isHigh(m.risk.level)) highRiskFiles.add(t.file);
      words.push(m.name.toLowerCase());
      if (m.oldName) words.push(m.oldName.toLowerCase());
      // Çapa: ilk eşleşen üye kazanır (eski doğrusal taramayla aynı öncelik).
      if (m.status === 'unchanged' && m.overriddenBy.length === 0) continue;
      for (const c of m.callers) setIfAbsent(anchorByOutside, c.fromId, m.id);
      for (const o of m.overriddenBy) setIfAbsent(anchorByOutside, o, m.status === 'unchanged' ? m.ownerTypeId : m.id);
    }
    typeSearch.set(t.id, words);
  }
  for (const t of review.types) for (const s of t.subTypes) setIfAbsent(anchorByOutside, s, t.id);

  const searchText = new Map<string, string>();
  for (const f of review.files) {
    const parts = [f.path.toLowerCase()];
    for (const id of f.typeIds) {
      const words = typeSearch.get(id);
      if (words) parts.push(...words);
    }
    searchText.set(f.id, parts.join('\n'));
  }

  const findingsBySymbol = new Map<string, Finding[]>();
  const findingsByFile = new Map<string, Finding[]>();
  const total = emptySeverityCounts();
  const byCategory = new Map<FindingCategory, SeverityCounts>();
  for (const f of review.findings) {
    if (f.file) push(findingsByFile, f.file, f);
    for (const s of f.symbolIds ?? []) push(findingsBySymbol, s, f);
    total[f.severity]++;
    const c = byCategory.get(f.category) ?? emptySeverityCounts();
    c[f.severity]++;
    byCategory.set(f.category, c);
  }
  const groupsBySymbol = new Map<string, ChangeGroup[]>();
  for (const g of review.groups) for (const s of g.symbolIds) push(groupsBySymbol, s, g);
  const groupsByRisk = [...review.groups].sort(
    (a, b) => RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel] || b.symbolIds.length - a.symbolIds.length,
  );

  return {
    fileById,
    typeById,
    memberById,
    symbolFile,
    nodeById: new Map(review.graph.nodes.map((n) => [n.id, n])),
    stepByFile: new Map(review.reviewPlan.map((s) => [s.fileId, s])),
    findingsBySymbol,
    findingsByFile,
    groupsBySymbol,
    membersByOldId,
    planEntries: buildPlanEntries(review, fileById),
    highRiskFiles,
    searchText,
    anchorByOutside,
    sourceRoots: buildSourceRoots(review.types),
    groupsByRisk,
    findingCounts: { total, byCategory },
    fingerprintByFile: new Map(review.files.map((f) => [f.id, fileFingerprint(f)])),
  };
}

/** 'com.acme.Outer.Inner#m()' → 'com.acme.Outer' (büyük harfle başlayan ilk parça üst düzey tiptir; kök soneki atılır). */
export function topLevelFqn(symbolId: string): string {
  const { fqn } = parseSymbolId(symbolId);
  const parts = fqn.split('.');
  const i = parts.findIndex((p) => /^[A-Z]/.test(p));
  return i < 0 ? fqn : parts.slice(0, i + 1).join('.');
}

/** 'com.acme.Order#total(int)' → 'Order.total()' ; 'com.acme.Order@root' → 'Order'. */
export function shortId(id: string): string {
  const { fqn, member } = parseSymbolId(id);
  const simple = simpleTypeName(fqn);
  if (member === undefined) return simple;
  return member.includes('(') ? `${simple}.${memberName(member)}()` : `${simple}.${member}`;
}

export function symbolLabel(index: ReviewIndex, id: string): string {
  const m = index.memberById.get(id);
  if (m) {
    const owner = index.typeById.get(m.ownerTypeId);
    const name = m.kind === 'field' ? m.name : `${m.name}()`;
    return owner ? `${owner.name}.${name}` : name;
  }
  const t = index.typeById.get(id);
  if (t) return t.name;
  return index.nodeById.get(id)?.label ?? shortId(id);
}

/** Etiketin son parçası (üye adı): 'Order.total()' → 'total()'. Kök soneki içeren etiketlerde de doğru çalışır. */
export function symbolTail(index: ReviewIndex, id: string): string {
  const m = index.memberById.get(id);
  if (m) return m.kind === 'field' ? m.name : `${m.name}()`;
  const t = index.typeById.get(id);
  if (t) return t.name;
  const label = shortId(id);
  return label.slice(label.lastIndexOf('.') + 1) || label;
}

/**
 * Diff dışındaki bir sembol için onu etkileyen diff içi sembol: çağırdığı, override ettiği
 * ya da alt tipi olduğu değişen sembol. (Önceden kurulmuş haritadan, O(1).)
 */
export function findAnchor(index: ReviewIndex, outsideId: string): string | undefined {
  return index.anchorByOutside.get(outsideId);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Uzun dizin yolunu okunur kısaltır: 'src/main/java/com/shop/domain' → 'com/shop/domain'. */
export function compactDir(path: string): string {
  return dirName(path).replace(/^(.*\/)?src\/(main|test)\/(java|kotlin|resources)\/?/, '$2:');
}

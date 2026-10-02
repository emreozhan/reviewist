import type {
  ChangeGroup,
  FileChange,
  Finding,
  FindingCategory,
  Layer,
  ReviewModel,
  RiskLevel,
} from '../../../src/shared/types';
import type { PlanEntry, ReviewIndex, Severity } from './reviewIndex';

export type { PlanEntry } from './reviewIndex';

export interface NavFilters {
  hideCosmetic: boolean;
  onlyHighRisk: boolean;
  hideTests: boolean;
  query: string;
}

export const DEFAULT_FILTERS: NavFilters = { hideCosmetic: true, onlyHighRisk: false, hideTests: false, query: '' };

export const isHighRisk = (level: RiskLevel): boolean => level === 'high' || level === 'critical';

export const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Bu sayıdan fazla adımlı planda düşük riskli Java dışı adımlar özet satırına katlanır. */
export const LARGE_PLAN = 150;

export function matchesQuery(file: FileChange, index: ReviewIndex, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (index.searchText.get(file.id) ?? file.path.toLowerCase()).includes(q);
}

/** Kozmetik dışındaki filtreler (kozmetik ayrı bölüme alınır). */
export function passesFilters(file: FileChange, index: ReviewIndex, filters: NavFilters): boolean {
  if (filters.hideTests && file.isTest) return false;
  if (filters.onlyHighRisk && !index.highRiskFiles.has(file.id)) return false;
  return matchesQuery(file, index, filters.query);
}

export type FoldKey = 'cosmetic' | 'lowrisk';

/** Planın sonunda katlanmış özet satırı. */
export interface PlanFold {
  key: FoldKey;
  title: string;
  /** Kısa döküm: 'xml 120 · yaml 40'. */
  breakdown?: string;
  entries: PlanEntry[];
}

export interface PlanView {
  main: PlanEntry[];
  folds: PlanFold[];
  /** Kozmetik dosyalar: hideCosmetic açıkken sona katlanmış bölüm (folds içindeki 'cosmetic'). */
  cosmetic: PlanEntry[];
}

/** Okuma planı sırası: önce plan adımları, sonra plana girmemiş dosyalar (reviewOrder'a göre). İndekste hazırdır. */
export function orderedEntries(_review: ReviewModel, index: ReviewIndex): PlanEntry[] {
  return index.planEntries;
}

/** Büyük planda katlanacak "düşük değerli" adım: düşük riskli, kozmetik olmayan, Java dışı dosya. */
export function isLowValueStep(file: FileChange): boolean {
  return !file.cosmeticOnly && file.risk.level === 'low' && file.language !== 'java';
}

function breakdownOf(entries: readonly PlanEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.file.language, (counts.get(e.file.language) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang, n]) => `${lang === 'other' ? 'diğer' : lang} ${n}`)
    .join(' · ');
}

const planCache = new WeakMap<ReviewIndex, { filters: NavFilters; view: PlanView }>();

export function planView(review: ReviewModel, index: ReviewIndex, filters: NavFilters): PlanView {
  const cached = planCache.get(index);
  if (cached && cached.filters === filters) return cached.view;
  const large = index.planEntries.length > LARGE_PLAN;
  const main: PlanEntry[] = [];
  const cosmetic: PlanEntry[] = [];
  const lowrisk: PlanEntry[] = [];
  for (const e of orderedEntries(review, index)) {
    if (!passesFilters(e.file, index, filters)) continue;
    if (filters.hideCosmetic && e.file.cosmeticOnly) cosmetic.push(e);
    else if (large && isLowValueStep(e.file)) lowrisk.push(e);
    else main.push(e);
  }
  const folds: PlanFold[] = [];
  if (lowrisk.length > 0) {
    folds.push({ key: 'lowrisk', title: 'Düşük riskli Java dışı dosyalar', breakdown: breakdownOf(lowrisk), entries: lowrisk });
  }
  if (cosmetic.length > 0) folds.push({ key: 'cosmetic', title: 'Kozmetik — güvenle atlanabilir', entries: cosmetic });
  const view = { main, folds, cosmetic };
  planCache.set(index, { filters, view });
  return view;
}

/**
 * Klavye gezintisi için görünür sıra. `openFolds` verilirse yalnız açık özet bölümleri dahil edilir
 * (katlanmış kozmetik/düşük riskli adımlar j/k/n ile atlanır); verilmezse hepsi sondadır.
 */
export function navigationOrder(view: PlanView, openFolds?: Readonly<Record<string, boolean>>): string[] {
  const out = view.main.map((e) => e.file.id);
  for (const fold of view.folds) {
    if (openFolds && !openFolds[fold.key]) continue;
    for (const e of fold.entries) out.push(e.file.id);
  }
  return out;
}

export type PlanRow =
  | { kind: 'step'; key: string; entry: PlanEntry }
  | { kind: 'fold'; key: string; fold: PlanFold; open: boolean };

/** Plan görünümünü pencerelenebilir düz satır listesine çevirir. */
export function planRows(view: PlanView, openFolds: Readonly<Record<string, boolean>>): PlanRow[] {
  const rows: PlanRow[] = view.main.map((entry) => ({ kind: 'step', key: entry.file.id, entry }));
  for (const fold of view.folds) {
    const open = !!openFolds[fold.key];
    rows.push({ kind: 'fold', key: `fold:${fold.key}`, fold, open });
    if (open) for (const entry of fold.entries) rows.push({ kind: 'step', key: entry.file.id, entry });
  }
  return rows;
}

export function stepFile(order: readonly string[], current: string | null, dir: 1 | -1): string | undefined {
  if (order.length === 0) return undefined;
  const idx = current ? order.indexOf(current) : -1;
  if (idx < 0) return dir === 1 ? order[0] : order[order.length - 1];
  const next = idx + dir;
  if (next < 0 || next >= order.length) return undefined;
  return order[next];
}

/** Mevcut dosyadan sonraki ilk görülmemiş dosya (sona gelince başa sarar). */
export function nextUnseen(order: readonly string[], current: string | null, seen: Readonly<Record<string, boolean>>): string | undefined {
  if (order.length === 0) return undefined;
  const start = current ? order.indexOf(current) : -1;
  for (let k = 1; k <= order.length; k++) {
    const id = order[(start + k + order.length) % order.length];
    if (id && !seen[id]) return id;
  }
  return undefined;
}

export const LAYER_ORDER: Layer[] = [
  'domain', 'port', 'application', 'service', 'model', 'adapter-in', 'controller', 'adapter-out', 'repository',
  'config', 'util', 'resource', 'build', 'test', 'other',
];

export const LAYER_LABEL: Record<Layer, string> = {
  domain: 'Domain',
  application: 'Uygulama',
  port: 'Port',
  'adapter-in': 'Giriş adaptörü',
  'adapter-out': 'Çıkış adaptörü',
  controller: 'Controller',
  service: 'Servis',
  repository: 'Repository',
  model: 'Model',
  config: 'Yapılandırma',
  util: 'Yardımcı',
  test: 'Test',
  build: 'Derleme',
  resource: 'Kaynak',
  other: 'Diğer',
};

export interface LayerTreeNode {
  layer: Layer;
  packages: { name: string; files: FileChange[] }[];
  count: number;
}

export function layerTree(review: ReviewModel, index: ReviewIndex, filters: NavFilters): LayerTreeNode[] {
  const byLayer = new Map<Layer, Map<string, FileChange[]>>();
  for (const f of review.files) {
    if (!passesFilters(f, index, filters)) continue;
    if (filters.hideCosmetic && f.cosmeticOnly) continue;
    const pkg = f.packageName ?? (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '(kök)');
    let layerMap = byLayer.get(f.layer);
    if (!layerMap) {
      layerMap = new Map<string, FileChange[]>();
      byLayer.set(f.layer, layerMap);
    }
    const list = layerMap.get(pkg);
    if (list) list.push(f);
    else layerMap.set(pkg, [f]);
  }
  return LAYER_ORDER.filter((l) => byLayer.has(l)).map((layer) => {
    const pkgs = [...(byLayer.get(layer) ?? new Map<string, FileChange[]>()).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, files]) => ({ name, files: files.sort((a, b) => a.reviewOrder - b.reviewOrder) }));
    return { layer, packages: pkgs, count: pkgs.reduce((s, p) => s + p.files.length, 0) };
  });
}

export type LayerRow =
  | { kind: 'layer'; key: string; node: LayerTreeNode; open: boolean }
  | { kind: 'pkg'; key: string; name: string; count: number }
  | { kind: 'file'; key: string; file: FileChange };

export function layerRows(tree: readonly LayerTreeNode[], collapsed: ReadonlySet<Layer>): LayerRow[] {
  const rows: LayerRow[] = [];
  for (const node of tree) {
    const open = !collapsed.has(node.layer);
    rows.push({ kind: 'layer', key: `l:${node.layer}`, node, open });
    if (!open) continue;
    for (const pkg of node.packages) {
      rows.push({ kind: 'pkg', key: `p:${node.layer}:${pkg.name}`, name: pkg.name, count: pkg.files.length });
      for (const file of pkg.files) rows.push({ kind: 'file', key: `f:${file.id}`, file });
    }
  }
  return rows;
}

/** Grupta varsayılan olarak gösterilen dosya ve diff dışı sembol sayısı (dev gruplar katlanır). */
export const GROUP_FILE_LIMIT = 8;
export const GROUP_OUTSIDE_LIMIT = 12;

type GroupRowBase = { key: string; group: ChangeGroup; /** Grubun son satırı (kart alt kenarı). */ last?: boolean };

export type GroupRow =
  | (GroupRowBase & { kind: 'head'; fileCount: number })
  | (GroupRowBase & { kind: 'file'; file: FileChange })
  | (GroupRowBase & { kind: 'more'; hidden: number; open: boolean })
  | (GroupRowBase & { kind: 'outside'; ids: string[]; hidden: number });

/** Gruplar düz satırlara: başlık, (ilk N) dosya, "+N dosya", diff dışı semboller. */
export function groupRows(index: ReviewIndex, filters: NavFilters, expanded: ReadonlySet<string>): GroupRow[] {
  const rows: GroupRow[] = [];
  for (const g of index.groupsByRisk) {
    const files: FileChange[] = [];
    for (const id of g.fileIds) {
      const f = index.fileById.get(id);
      if (f && passesFilters(f, index, filters)) files.push(f);
    }
    if (files.length === 0 && filters.query) continue;
    rows.push({ kind: 'head', key: `g:${g.id}`, group: g, fileCount: files.length });
    const open = expanded.has(g.id);
    const shown = open ? files : files.slice(0, GROUP_FILE_LIMIT);
    for (const file of shown) rows.push({ kind: 'file', key: `g:${g.id}:${file.id}`, group: g, file });
    if (files.length > GROUP_FILE_LIMIT) {
      rows.push({ kind: 'more', key: `g:${g.id}:more`, group: g, hidden: files.length - shown.length, open });
    }
    const outside = g.symbolIds.filter((id) => !index.symbolFile.has(id));
    if (outside.length > 0) {
      const ids = outside.slice(0, GROUP_OUTSIDE_LIMIT);
      rows.push({ kind: 'outside', key: `g:${g.id}:out`, group: g, ids, hidden: outside.length - ids.length });
    }
    const lastRow = rows[rows.length - 1];
    if (lastRow) lastRow.last = true;
  }
  return rows;
}

export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  api: 'Public API',
  inheritance: 'Kalıtım',
  callers: 'Çağıranlar',
  test: 'Test',
  architecture: 'Mimari',
  risk: 'Risk',
  cosmetic: 'Kozmetik',
  complexity: 'Karmaşıklık',
  other: 'Diğer',
};

export interface FindingFilter {
  /** Bu önem ve daha ağır olanlar gösterilir. */
  minSeverity: Severity;
  /** null: tüm kategoriler. */
  category: FindingCategory | null;
}

/** Varsayılan: hata + uyarı (bilgi notları gürültü). */
export const DEFAULT_FINDING_FILTER: FindingFilter = { minSeverity: 'warning', category: null };

export interface CategoryCount {
  category: FindingCategory;
  /** Önem filtresinden geçen bulgu sayısı. */
  count: number;
  /** Önem filtresinden bağımsız toplam. */
  total: number;
  worst: Severity;
}

/** Kategori sayaçları (önem filtresine göre); en ağır, sonra en kalabalık kategori önce. */
export function categoryCounts(index: ReviewIndex, minSeverity: Severity): CategoryCount[] {
  const limit = SEVERITY_RANK[minSeverity];
  const out: CategoryCount[] = [];
  for (const [category, c] of index.findingCounts.byCategory) {
    const count = (limit >= 0 ? c.error : 0) + (limit >= 1 ? c.warning : 0) + (limit >= 2 ? c.info : 0);
    const worst: Severity = c.error > 0 ? 'error' : c.warning > 0 ? 'warning' : 'info';
    out.push({ category, count, total: c.error + c.warning + c.info, worst });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.count - a.count);
}

/** Önem + kategori filtresi; önem sırasıyla (hata önce). */
export function filterFindings(findings: readonly Finding[], filter: FindingFilter): Finding[] {
  const limit = SEVERITY_RANK[filter.minSeverity];
  const buckets: Finding[][] = [[], [], []];
  for (const f of findings) {
    const rank = SEVERITY_RANK[f.severity];
    if (rank > limit) continue;
    if (filter.category && f.category !== filter.category) continue;
    buckets[rank]?.push(f);
  }
  return buckets.flat();
}

export interface FindingGroup {
  category: FindingCategory;
  items: Finding[];
  worst: Severity;
}

/** Bulguları kategoriye göre gruplar; grupları ve içerikleri en ağır önemden başlayarak sıralar. */
export function groupFindings(findings: readonly Finding[], minSeverity?: Severity): FindingGroup[] {
  const sorted = filterFindings(findings, { minSeverity: minSeverity ?? 'info', category: null });
  const map = new Map<FindingCategory, Finding[]>();
  for (const f of sorted) {
    const list = map.get(f.category);
    if (list) list.push(f);
    else map.set(f.category, [f]);
  }
  return [...map.entries()]
    .map(([category, items]) => ({ category, items, worst: items[0]?.severity ?? 'info' }))
    .sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.items.length - a.items.length);
}

export type FindingRow =
  | { kind: 'cat'; key: string; category: FindingCategory; count: number; worst: Severity }
  | { kind: 'finding'; key: string; finding: Finding };

/** Bulgu sayfası için kategori başlıklı düz satır listesi. */
export function findingRows(groups: readonly FindingGroup[]): FindingRow[] {
  const rows: FindingRow[] = [];
  for (const g of groups) {
    rows.push({ kind: 'cat', key: `c:${g.category}`, category: g.category, count: g.items.length, worst: g.worst });
    for (const f of g.items) rows.push({ kind: 'finding', key: f.id, finding: f });
  }
  return rows;
}

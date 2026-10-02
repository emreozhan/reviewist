import type {
  FileChange,
  Finding,
  FindingCategory,
  Layer,
  ReviewModel,
  ReviewStep,
  RiskLevel,
} from '../../../src/shared/types';
import type { ReviewIndex } from './reviewIndex';

export interface NavFilters {
  hideCosmetic: boolean;
  onlyHighRisk: boolean;
  hideTests: boolean;
  query: string;
}

export const DEFAULT_FILTERS: NavFilters = { hideCosmetic: true, onlyHighRisk: false, hideTests: false, query: '' };

export const isHighRisk = (level: RiskLevel): boolean => level === 'high' || level === 'critical';

export const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function fileIsHighRisk(file: FileChange, index: ReviewIndex): boolean {
  if (isHighRisk(file.risk.level)) return true;
  return file.typeIds.some((id) => {
    const t = index.typeById.get(id);
    return !!t && (isHighRisk(t.risk.level) || t.members.some((m) => isHighRisk(m.risk.level)));
  });
}

export function matchesQuery(file: FileChange, index: ReviewIndex, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (file.path.toLowerCase().includes(q)) return true;
  return file.typeIds.some((id) => {
    const t = index.typeById.get(id);
    if (!t) return false;
    if (t.name.toLowerCase().includes(q)) return true;
    return t.members.some((m) => m.name.toLowerCase().includes(q) || (m.oldName?.toLowerCase().includes(q) ?? false));
  });
}

/** Kozmetik dışındaki filtreler (kozmetik ayrı bölüme alınır). */
export function passesFilters(file: FileChange, index: ReviewIndex, filters: NavFilters): boolean {
  if (filters.hideTests && file.isTest) return false;
  if (filters.onlyHighRisk && !fileIsHighRisk(file, index)) return false;
  return matchesQuery(file, index, filters.query);
}

export interface PlanEntry {
  file: FileChange;
  step: ReviewStep | null;
  order: number;
}

export interface PlanView {
  main: PlanEntry[];
  /** Kozmetik dosyalar: hideCosmetic açıkken sona katlanmış bölüm. */
  cosmetic: PlanEntry[];
}

/** Okuma planı sırası: önce plan adımları, sonra plana girmemiş dosyalar (reviewOrder'a göre). */
export function orderedEntries(review: ReviewModel, index: ReviewIndex): PlanEntry[] {
  const entries: PlanEntry[] = [];
  const seen = new Set<string>();
  for (const step of [...review.reviewPlan].sort((a, b) => a.order - b.order)) {
    const file = index.fileById.get(step.fileId);
    if (!file || seen.has(file.id)) continue;
    seen.add(file.id);
    entries.push({ file, step, order: entries.length + 1 });
  }
  const rest = review.files.filter((f) => !seen.has(f.id)).sort((a, b) => a.reviewOrder - b.reviewOrder);
  for (const file of rest) entries.push({ file, step: null, order: entries.length + 1 });
  return entries;
}

export function planView(review: ReviewModel, index: ReviewIndex, filters: NavFilters): PlanView {
  const all = orderedEntries(review, index).filter((e) => passesFilters(e.file, index, filters));
  if (!filters.hideCosmetic) return { main: all, cosmetic: [] };
  return { main: all.filter((e) => !e.file.cosmeticOnly), cosmetic: all.filter((e) => e.file.cosmeticOnly) };
}

/** Klavye gezintisi için görünür sıra (kozmetikler en sonda). */
export function navigationOrder(view: PlanView): string[] {
  return [...view.main, ...view.cosmetic].map((e) => e.file.id);
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
    const layerMap = byLayer.get(f.layer) ?? new Map<string, FileChange[]>();
    byLayer.set(f.layer, layerMap);
    layerMap.set(pkg, [...(layerMap.get(pkg) ?? []), f]);
  }
  return LAYER_ORDER.filter((l) => byLayer.has(l)).map((layer) => {
    const pkgs = [...(byLayer.get(layer) ?? new Map<string, FileChange[]>()).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, files]) => ({ name, files: [...files].sort((a, b) => a.reviewOrder - b.reviewOrder) }));
    return { layer, packages: pkgs, count: pkgs.reduce((s, p) => s + p.files.length, 0) };
  });
}

export const SEVERITY_RANK: Record<Finding['severity'], number> = { error: 0, warning: 1, info: 2 };

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

export interface FindingGroup {
  category: FindingCategory;
  items: Finding[];
  worst: Finding['severity'];
}

/** Bulguları kategoriye göre gruplar; grupları ve içerikleri en ağır önemden başlayarak sıralar. */
export function groupFindings(findings: readonly Finding[], minSeverity?: Finding['severity']): FindingGroup[] {
  const limit = minSeverity ? SEVERITY_RANK[minSeverity] : 2;
  const map = new Map<FindingCategory, Finding[]>();
  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] > limit) continue;
    map.set(f.category, [...(map.get(f.category) ?? []), f]);
  }
  return [...map.entries()]
    .map(([category, items]) => {
      const sorted = [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
      return { category, items: sorted, worst: sorted[0]?.severity ?? 'info' };
    })
    .sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.items.length - a.items.length);
}

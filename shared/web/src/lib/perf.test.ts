import { describe, expect, it } from 'vitest';
import { makeLargeReview } from '../mock/largeReview';
import { propagationFor } from './propagation';
import { buildIndex } from './reviewIndex';
import {
  categoryCounts,
  DEFAULT_FILTERS,
  DEFAULT_FINDING_FILTER,
  filterFindings,
  findingRows,
  groupFindings,
  groupRows,
  layerRows,
  layerTree,
  navigationOrder,
  planRows,
  planView,
} from './selectors';
import { structureRows } from './structureRows';
import { summarizeWarnings } from './warnings';

/**
 * Büyük model ölçümleri (guava sürüm aralığı ölçeği). Eşikler CI dalgalanmasına pay bırakır;
 * asıl amaç her render'da tüm modeli tarayan ya da karesel çalışan kodu yakalamak. Süreler konsola yazılır.
 */
const SIZE = { files: 2000, types: 3000, members: 20_000, findings: 5000 };

/**
 * Mutlak süre eşikleri yük altında kararsızdır: yalnız `REVIEWIST_PERF=1` ya da `npm run test:perf` ile doğrulanır.
 * Doğruluk kontrolleri (boyutlar, sonuçlar) her zaman çalışır; süreler her koşuda konsola yazılır.
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const STRICT_PERF = env.REVIEWIST_PERF === '1' || env.npm_lifecycle_event === 'test:perf';

function expectFast(ms: number, limit: number): void {
  if (STRICT_PERF) expect(ms).toBeLessThan(limit);
}

function time<T>(label: string, fn: () => T, runs = 1): { value: T; ms: number } {
  let value = fn();
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) value = fn();
  const ms = (performance.now() - t0) / runs;
  console.log(`[perf] ${label}: ${ms.toFixed(2)} ms`);
  return { value, ms };
}

describe('büyük model seçici süreleri', () => {
  const genStart = performance.now();
  const review = makeLargeReview(SIZE);
  console.log(`[perf] sentetik model üretimi: ${(performance.now() - genStart).toFixed(0)} ms`);
  const memberCount = review.types.reduce((n, t) => n + t.members.length, 0);

  it('model istenen boyutta', () => {
    expect(review.files).toHaveLength(SIZE.files);
    expect(review.types).toHaveLength(SIZE.types);
    expect(memberCount).toBe(SIZE.members);
    expect(review.findings).toHaveLength(SIZE.findings);
    expect(review.reviewPlan.length).toBe(SIZE.files);
  });

  const { value: index, ms: indexMs } = time('buildIndex', () => buildIndex(review));

  it('indeks tek geçişte kurulur', () => {
    expectFast(indexMs, 400);
    expect(index.memberById.size).toBe(SIZE.members);
    expect(index.planEntries).toHaveLength(SIZE.files);
  });

  it('plan görünümü + satırlar (filtre değişimi başına)', () => {
    let n = 0;
    const { ms } = time('planView + planRows (yeni filtre)', () => {
      const v = planView(review, index, { ...DEFAULT_FILTERS, hideTests: n++ % 2 === 0 });
      return planRows(v, {});
    }, 10);
    expectFast(ms, 30);
    const cached = time('planView (aynı filtre, önbellek)', () => planView(review, index, DEFAULT_FILTERS), 100);
    expectFast(cached.ms, 0.5);
  });

  it('arama sorgusu (tuş başına)', () => {
    const { value, ms } = time('planView arama "method1234"', () => planView(review, index, { ...DEFAULT_FILTERS, query: 'method1234' }), 10);
    expect(value.main.length).toBeGreaterThan(0);
    expectFast(ms, 30);
  });

  it('yalnız riskli adımlar', () => {
    const { ms } = time('planView yalnız riskli', () => planView(review, index, { ...DEFAULT_FILTERS, onlyHighRisk: true }), 10);
    expectFast(ms, 20);
  });

  it('j/k gezinti sırası', () => {
    const view = planView(review, index, DEFAULT_FILTERS);
    const { ms } = time('navigationOrder', () => navigationOrder(view, {}), 20);
    expectFast(ms, 5);
  });

  it('katman ağacı', () => {
    const { ms } = time('layerTree + layerRows', () => layerRows(layerTree(review, index, { ...DEFAULT_FILTERS }), new Set()), 10);
    expectFast(ms, 40);
  });

  it('gruplar', () => {
    const { ms } = time('groupRows', () => groupRows(index, { ...DEFAULT_FILTERS }, new Set()), 10);
    expectFast(ms, 40);
  });

  it('bulgular', () => {
    const f = time('filterFindings (hata+uyarı)', () => filterFindings(review.findings, DEFAULT_FINDING_FILTER), 20);
    expectFast(f.ms, 10);
    const c = time('categoryCounts', () => categoryCounts(index, 'warning'), 100);
    expectFast(c.ms, 1);
    const rows = time('groupFindings + findingRows (tümü)', () => findingRows(groupFindings(review.findings)), 10);
    expectFast(rows.ms, 20);
  });

  it('en kalabalık dosyanın yapı satırları', () => {
    const file = [...review.files].sort((a, b) => b.typeIds.length - a.typeIds.length)[0];
    expect(file).toBeDefined();
    if (!file) return;
    const types = file.typeIds.map((id) => index.typeById.get(id)).filter((t) => t !== undefined);
    const { ms } = time('structureRows (değişmeyenler dahil)', () => structureRows(types, true), 20);
    expectFast(ms, 5);
  });

  it('800 çağıranlı hub üyenin yayılımı', () => {
    const hub = review.types.flatMap((t) => t.members).sort((a, b) => b.callers.length - a.callers.length)[0];
    expect(hub?.callers.length).toBeGreaterThanOrEqual(800);
    if (!hub) return;
    const { ms } = time('propagationFor(hub)', () => propagationFor(index, hub.id), 10);
    expectFast(ms, 20);
  });

  it('uyarı özeti', () => {
    const { ms } = time('summarizeWarnings', () => summarizeWarnings(review), 10);
    expectFast(ms, 10);
  });

  it('JSON boyutu ve ayrıştırma (istemci tarafı yükleme maliyeti)', () => {
    const text = JSON.stringify(review);
    console.log(`[perf] sentetik model JSON: ${(text.length / 1024 / 1024).toFixed(1)} MB`);
    const { ms } = time('JSON.parse', () => JSON.parse(text) as unknown);
    expectFast(ms, 2000);
  });
});

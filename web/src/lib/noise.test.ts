import { describe, expect, it } from 'vitest';
import type { CallRef, ReviewModel } from '../../../src/shared/types';
import { makeLargeReview } from '../mock/largeReview';
import { sampleReview } from '../mock/sampleReview';
import { callerCounts, propagationFor } from './propagation';
import { buildIndex } from './reviewIndex';
import {
  categoryCounts,
  DEFAULT_FILTERS,
  DEFAULT_FINDING_FILTER,
  filterFindings,
  GROUP_FILE_LIMIT,
  groupRows,
  isLowValueStep,
  LARGE_PLAN,
  layerRows,
  layerTree,
  navigationOrder,
  planRows,
  planView,
} from './selectors';
import { structureRows } from './structureRows';
import { classifyWarning, summarizeWarnings } from './warnings';

const large = makeLargeReview({ files: 400, types: 600, members: 3000, findings: 800, groups: 40 });
const lindex = buildIndex(large);

describe('büyük planda gürültü katlama', () => {
  it(`>${LARGE_PLAN} adımda kozmetik ve düşük riskli Java dışı adımlar özet satırlarına katlanır`, () => {
    const view = planView(large, lindex, DEFAULT_FILTERS);
    const keys = view.folds.map((f) => f.key);
    expect(keys).toEqual(['lowrisk', 'cosmetic']);
    expect(view.main.some((e) => e.file.cosmeticOnly || isLowValueStep(e.file))).toBe(false);
    const total = view.main.length + view.folds.reduce((n, f) => n + f.entries.length, 0);
    expect(total).toBe(large.files.length);
    expect(view.folds[0]?.breakdown).toMatch(/xml \d+/);
  });

  it('katlı bölümler satır listesinde tek özet satırıdır; açılınca adımlar görünür', () => {
    const view = planView(large, lindex, DEFAULT_FILTERS);
    const closed = planRows(view, {});
    expect(closed.filter((r) => r.kind === 'fold')).toHaveLength(2);
    expect(closed).toHaveLength(view.main.length + 2);
    const open = planRows(view, { lowrisk: true });
    expect(open.length).toBe(view.main.length + 2 + (view.folds[0]?.entries.length ?? 0));
  });

  it('j/k/n sırası katlı bölümleri atlar, açılınca dahil eder', () => {
    const view = planView(large, lindex, DEFAULT_FILTERS);
    expect(navigationOrder(view, {})).toHaveLength(view.main.length);
    const cos = view.folds.find((f) => f.key === 'cosmetic');
    expect(navigationOrder(view, { cosmetic: true })).toHaveLength(view.main.length + (cos?.entries.length ?? 0));
  });

  it('küçük planda düşük riskli Java dışı dosyalar katlanmaz', () => {
    const index = buildIndex(sampleReview);
    const view = planView(sampleReview, index, DEFAULT_FILTERS);
    expect(view.folds.map((f) => f.key)).toEqual(['cosmetic']);
  });

  it('aynı filtre nesnesiyle plan görünümü önbellekten gelir (render başına yeniden hesap yok)', () => {
    const a = planView(large, lindex, DEFAULT_FILTERS);
    expect(planView(large, lindex, DEFAULT_FILTERS)).toBe(a);
    expect(planView(large, lindex, { ...DEFAULT_FILTERS })).not.toBe(a);
  });

  it('yalnız riskli ve testleri gizle filtreleri', () => {
    const risky = planView(large, lindex, { ...DEFAULT_FILTERS, onlyHighRisk: true });
    expect(risky.main.every((e) => lindex.highRiskFiles.has(e.file.id))).toBe(true);
    const noTests = planView(large, lindex, { ...DEFAULT_FILTERS, hideTests: true });
    expect([...noTests.main, ...noTests.folds.flatMap((f) => f.entries)].some((e) => e.file.isTest)).toBe(false);
  });
});

describe('çağıran güven filtresi', () => {
  const callers: CallRef[] = [
    { fromId: 'a#x()', file: 'A.java', line: 1, inChangedCode: false, confidence: 'exact' },
    { fromId: 'b#x()', file: 'B.java', line: 1, inChangedCode: true, confidence: 'likely' },
    { fromId: 'c#x()', file: 'C.java', line: 1, inChangedCode: false, confidence: 'name-only' },
    { fromId: 'd#x()', file: 'D.java', line: 1, inChangedCode: false, confidence: 'name-only' },
  ];

  it('sayaçlar name-only eşleşmeleri ayrı tutar', () => {
    expect(callerCounts(callers)).toEqual({ verified: 2, likely: 1, unverified: 2, outside: 1 });
    // Denetçiyle aynı ölçüt: çağıran dosya diff'te değilse "diff dışı".
    expect(callerCounts(callers, (f) => f === 'A.java' || f === 'B.java').outside).toBe(0);
    expect(callerCounts(callers, () => false).outside).toBe(2);
  });

  it('yayılım bölümlerinde name-only varsayılan olarak gizli listededir; exact önce gelir', () => {
    const m = large.types.flatMap((t) => t.members).find((mm) => mm.callers.some((c) => c.confidence === 'name-only'));
    expect(m).toBeDefined();
    if (!m) return;
    const secs = propagationFor(lindex, m.id).filter((s) => s.id === 'callersIn' || s.id === 'callersOut');
    const shown = secs.flatMap((s) => s.items);
    const hidden = secs.flatMap((s) => s.unverified);
    expect(shown.some((i) => i.confidence === 'name-only')).toBe(false);
    expect(hidden.length).toBe(m.callers.filter((c) => c.confidence === 'name-only').length);
    for (const s of secs) {
      const firstLikely = s.items.findIndex((i) => i.confidence === 'likely');
      if (firstLikely >= 0) expect(s.items.slice(firstLikely).some((i) => i.confidence === 'exact')).toBe(false);
    }
  });
});

describe('bulgu filtresi ve kategori sayaçları', () => {
  it('varsayılan: hata + uyarı; bilgi notları gizli, hatalar önce', () => {
    expect(DEFAULT_FINDING_FILTER.minSeverity).toBe('warning');
    const out = filterFindings(large.findings, DEFAULT_FINDING_FILTER);
    expect(out.some((f) => f.severity === 'info')).toBe(false);
    expect(out.length).toBe(lindex.findingCounts.total.error + lindex.findingCounts.total.warning);
    const firstWarning = out.findIndex((f) => f.severity === 'warning');
    expect(out.slice(firstWarning).some((f) => f.severity === 'error')).toBe(false);
  });

  it('kategori sayaçları önem filtresine göre; kategori filtresi uygulanır', () => {
    const cats = categoryCounts(lindex, 'warning');
    const sum = cats.reduce((n, c) => n + c.count, 0);
    expect(sum).toBe(filterFindings(large.findings, DEFAULT_FINDING_FILTER).length);
    const callers = cats.find((c) => c.category === 'callers');
    expect(callers).toBeDefined();
    const only = filterFindings(large.findings, { minSeverity: 'warning', category: 'callers' });
    expect(only.length).toBe(callers?.count);
    expect(only.every((f) => f.category === 'callers')).toBe(true);
  });
});

describe('düz satır listeleri', () => {
  it('katman ağacı katlanınca dosya satırları çıkar', () => {
    const tree = layerTree(large, lindex, DEFAULT_FILTERS);
    const all = layerRows(tree, new Set());
    const first = tree[0];
    expect(first).toBeDefined();
    if (!first) return;
    const folded = layerRows(tree, new Set([first.layer]));
    expect(all.length - folded.length).toBe(first.count + first.packages.length);
  });

  it('dev grupta ilk dosyalar gösterilir, "+N dosya" satırıyla açılır; son satır işaretli', () => {
    const rows = groupRows(lindex, DEFAULT_FILTERS, new Set());
    const g0 = large.groups[0];
    expect(g0).toBeDefined();
    if (!g0) return;
    const files = rows.filter((r) => r.group.id === g0.id && r.kind === 'file');
    expect(files.length).toBeLessThanOrEqual(GROUP_FILE_LIMIT);
    expect(rows.some((r) => r.group.id === g0.id && r.kind === 'more')).toBe(true);
    const open = groupRows(lindex, DEFAULT_FILTERS, new Set([g0.id])).filter((r) => r.group.id === g0.id && r.kind === 'file');
    expect(open.length).toBeGreaterThan(GROUP_FILE_LIMIT);
    const perGroupLast = rows.filter((r) => r.last).length;
    expect(perGroupLast).toBe(new Set(rows.map((r) => r.group.id)).size);
  });

  it('yapı satırları: tip başlığı, önem sırasında değişen üyeler, "değişmeyenleri göster" satırı', () => {
    const file = large.files.find((f) => f.typeIds.length > 1);
    expect(file).toBeDefined();
    if (!file) return;
    const types = file.typeIds.map((id) => lindex.typeById.get(id)).filter((t) => t !== undefined);
    const rows = structureRows(types, false);
    expect(rows.filter((r) => r.kind === 'type')).toHaveLength(types.length);
    expect(rows.filter((r) => r.kind === 'member').every((r) => r.kind === 'member' && r.member.status !== 'unchanged')).toBe(true);
    const withAll = structureRows(types, true);
    expect(withAll.filter((r) => r.kind === 'member')).toHaveLength(types.reduce((n, t) => n + t.members.length, 0));
    expect(rows[0]?.first).toBe(true);
    expect(rows.filter((r) => r.last)).toHaveLength(types.length);
  });
});

describe('analiz uyarıları', () => {
  it('uyarılar türüne göre sınıflanır', () => {
    expect(classifyWarning('Ayrıştırma hatası: Foo.java')).toBe('parse');
    expect(classifyWarning('Repo indeksi en fazla 5000 .java dosyasıyla sınırlandı')).toBe('limit');
    expect(classifyWarning('Repo indeksinde 1 dosya okunamadı')).toBe('read');
    expect(classifyWarning('Beklenmedik durum')).toBe('other');
  });

  it('özet ayrıştırma hatalı diff dosyalarını da sayar', () => {
    const s = summarizeWarnings(large as ReviewModel);
    expect(s.parseErrorFiles.length).toBeGreaterThan(0);
    expect(s.total).toBe(large.warnings.length + s.parseErrorFiles.length);
    expect(s.groups.map((g) => g.kind)).toEqual(['parse', 'limit', 'read']);
  });
});

import { describe, expect, it } from 'vitest';
import { sampleReview } from '../mock/sampleReview';
import { PATHS } from '../mock/samplePaths';
import { buildIndex } from './reviewIndex';
import {
  DEFAULT_FILTERS,
  groupFindings,
  layerTree,
  navigationOrder,
  nextUnseen,
  orderedEntries,
  planView,
  stepFile,
} from './selectors';
import { propagationFor } from './propagation';
import { S } from '../mock/ids';

const review = sampleReview;
const index = buildIndex(review);

describe('okuma planı seçicileri', () => {
  it('plan sırasını izler ve tüm dosyaları kapsar', () => {
    const entries = orderedEntries(review, index);
    expect(entries).toHaveLength(review.files.length);
    expect(entries[0]?.file.path).toBe(PATHS.paymentGateway);
  });

  it('varsayılan filtrede kozmetik dosyalar ayrı (sona katlı) bölümdedir', () => {
    const view = planView(review, index, DEFAULT_FILTERS);
    expect(view.cosmetic.map((e) => e.file.path)).toEqual([PATHS.reportGenerator]);
    expect(view.main.some((e) => e.file.cosmeticOnly)).toBe(false);
    expect(navigationOrder(view).at(-1)).toBe(PATHS.reportGenerator);
  });

  it('kozmetik gizleme kapalıysa kozmetikler plan sırasında kalır', () => {
    const view = planView(review, index, { ...DEFAULT_FILTERS, hideCosmetic: false });
    expect(view.cosmetic).toHaveLength(0);
    expect(view.main).toHaveLength(review.files.length);
  });

  it('yalnız yüksek risk, testleri gizle ve arama filtreleri', () => {
    const high = planView(review, index, { ...DEFAULT_FILTERS, onlyHighRisk: true });
    expect(high.main.length).toBeGreaterThan(0);
    expect(high.main.length).toBeLessThan(review.files.length);
    const noTests = planView(review, index, { ...DEFAULT_FILTERS, hideTests: true });
    expect(noTests.main.some((e) => e.file.isTest)).toBe(false);
    const q = planView(review, index, { ...DEFAULT_FILTERS, query: 'legacyPad' });
    expect(q.main.map((e) => e.file.path)).toEqual([PATHS.stringUtils]);
    const renamed = planView(review, index, { ...DEFAULT_FILTERS, query: 'getTotal' });
    expect(renamed.main.map((e) => e.file.path)).toContain(PATHS.order);
  });

  it('j/k ve n gezintisi', () => {
    const order = ['a', 'b', 'c'];
    expect(stepFile(order, null, 1)).toBe('a');
    expect(stepFile(order, 'a', 1)).toBe('b');
    expect(stepFile(order, 'c', 1)).toBeUndefined();
    expect(stepFile(order, 'a', -1)).toBeUndefined();
    expect(nextUnseen(order, 'a', { b: true })).toBe('c');
    expect(nextUnseen(order, 'c', { a: true })).toBe('b');
    expect(nextUnseen(order, 'a', { a: true, b: true, c: true })).toBeUndefined();
  });

  it('katman ağacı katman sırasını izler', () => {
    const tree = layerTree(review, index, DEFAULT_FILTERS);
    expect(tree[0]?.layer).toBe('domain');
    expect(tree.flatMap((l) => l.packages.flatMap((p) => p.files)).some((f) => f.cosmeticOnly)).toBe(false);
  });

  it('bulgular kategoriye göre gruplanır, hata içeren gruplar önce gelir', () => {
    const groups = groupFindings(review.findings);
    expect(groups[0]?.worst).toBe('error');
    const errorsOnly = groupFindings(review.findings, 'error');
    expect(errorsOnly.every((g) => g.items.every((f) => f.severity === 'error'))).toBe(true);
  });
});

describe('yayılım', () => {
  it('port metodunda override edenler ve diff dışı çağıran ayrı bölümdedir', () => {
    const secs = propagationFor(index, S.pgCharge);
    const ids = secs.map((s) => s.id);
    expect(ids).toContain('overriddenBy');
    expect(ids).toContain('callersIn');
    const out = secs.find((s) => s.id === 'callersOut');
    expect(out?.outside).toBe(true);
    expect(out?.items.map((i) => i.label)).toEqual(['RefundService.compensate()']);
  });

  it('şablon metotta devralan alt tipler diff dışı olarak gelir', () => {
    const secs = propagationFor(index, S.anNotify);
    const inh = secs.find((s) => s.id === 'inheritors');
    expect(inh?.items).toHaveLength(3);
    expect(inh?.items.every((i) => !i.inDiff)).toBe(true);
  });
});

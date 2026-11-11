import { describe, expect, it } from 'vitest';
import { sampleReview } from './sampleReview';
import { sampleFiles } from './sampleFiles';

describe('örnek ReviewModel tutarlılığı', () => {
  const r = sampleReview;
  const fileIds = new Set(r.files.map((f) => f.id));
  const typeIds = new Set(r.types.map((t) => t.id));
  const nodeIds = new Set(r.graph.nodes.map((n) => n.id));

  it('15-20 dosya içerir ve her dosyanın hunk\'ı vardır', () => {
    expect(r.files.length).toBeGreaterThanOrEqual(15);
    expect(r.files.length).toBeLessThanOrEqual(20);
    for (const f of r.files) expect(f.hunks.length, f.path).toBeGreaterThan(0);
  });

  it('plan, gruplar ve bulgular var olan dosyalara işaret eder', () => {
    for (const s of r.reviewPlan) expect(fileIds.has(s.fileId), s.fileId).toBe(true);
    for (const g of r.groups) for (const f of g.fileIds) expect(fileIds.has(f), f).toBe(true);
    for (const f of r.findings) if (f.file) expect(fileIds.has(f.file), f.file).toBe(true);
    expect(new Set(r.reviewPlan.map((s) => s.fileId)).size).toBe(r.files.length);
  });

  it('dosyaların typeIds alanı tiplerle eşleşir', () => {
    for (const f of r.files) for (const id of f.typeIds) expect(typeIds.has(id), id).toBe(true);
    for (const t of r.types) expect(fileIds.has(t.file), t.file).toBe(true);
  });

  it('değişen üyelerin aralığında en az bir değişiklik satırı vardır', () => {
    for (const t of r.types) {
      for (const m of t.members) {
        if (m.status === 'unchanged' || m.status === 'moved') continue;
        expect(m.linesAdded + m.linesRemoved, m.id).toBeGreaterThan(0);
      }
    }
  });

  it('çağıran satırları içerikte gerçekten çağrı içerir', () => {
    for (const t of r.types) {
      for (const m of t.members) {
        for (const c of m.callers) {
          const content = sampleFiles[c.file]?.new;
          expect(content, c.file).toBeTruthy();
          const line = content?.split('\n')[c.line - 1] ?? '';
          expect(line.includes(m.name) || line.includes('PaymentResult') || line.includes('new '), `${m.id} ← ${c.file}:${c.line}`).toBe(true);
        }
      }
    }
  });

  it('graf kenarları var olan düğümleri bağlar ve diff dışı etkilenenler işaretlidir', () => {
    for (const e of r.graph.edges) {
      expect(nodeIds.has(e.from), e.from).toBe(true);
      expect(nodeIds.has(e.to), e.to).toBe(true);
    }
    expect(r.summary.impactedOutsideDiff).toBeGreaterThanOrEqual(6);
  });

  it('özet sayıları tutarlıdır', () => {
    expect(r.summary.files).toBe(r.files.length);
    expect(r.summary.cosmeticFiles).toBe(1);
    expect(r.summary.additions).toBeGreaterThan(0);
  });
});

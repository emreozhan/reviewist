/**
 * Kesinmiş gibi sunulmaması gereken iki yanlış pozitif kaynağı: ayrıştırma hatalı dosyada "silinen" üyeler ve
 * yorum/string içindeki anotasyon benzeri metinler.
 */
import { describe, expect, it } from 'vitest';
import type { ReviewModel } from '../shared/types.js';
import { semanticAnnotationChanges } from './analysis/risk.js';
import { extractCodeAnnotations, maskCommentsAndStrings } from './analysis/util.js';
import { buildReview } from './buildReview.js';
import { createMemoryChangeSet } from './testing/memoryChangeSet.js';

const P = 'src/main/java/p';
const member = (model: ReviewModel, id: string) => model.types.flatMap((t) => t.members).find((m) => m.id === id);

describe('ayrıştırma hatalı dosya', () => {
  it('hata yüzünden kaybolan üye "silindi/hâlâ çağrılıyor" değil, doğrulanamadı bilgisi', async () => {
    const OLD = 'package p;\n\npublic class Calc {\n    public int add(int a, int b) { return a + b; }\n    public int sub(int a, int b) { return a - b; }\n}\n';
    // Yeni sürümde sözdizimi hatası: add kapanmıyor, sub ayrıştırıcıya göre kayboluyor
    const NEW = 'package p;\n\npublic class Calc {\n    public int add(int a, int b) { return a + b;\n    public int sub(int a, int b) { return a - b; }\n}\n';
    const cs = createMemoryChangeSet({
      old: { [`${P}/Calc.java`]: OLD },
      new: { [`${P}/Calc.java`]: NEW },
      extraNewFiles: { [`${P}/Use.java`]: 'package p;\n\npublic class Use {\n    int a(Calc c) { return c.add(1, 2) + c.sub(3, 1); }\n}\n' },
    });
    const model = await buildReview(cs);
    const file = model.files.find((f) => f.path === `${P}/Calc.java`);
    expect(file?.parseError).toMatch(/Ayrıştırma hatası/);
    const removed = model.types.flatMap((t) => t.members).filter((m) => m.status === 'removed');
    expect(removed.map((m) => m.id)).toEqual(['p.Calc#sub(int,int)']);
    for (const m of removed) {
      const fs = model.findings.filter((f) => f.symbolIds?.[0] === m.id && /removed|renamed/.test(f.id));
      for (const f of fs) {
        expect(f.severity).toBe('info');
        expect(f.title).toMatch(/^Doğrulanamadı \(dosya tam ayrıştırılamadı\)/);
      }
      expect(member(model, m.id)?.risk.level).not.toBe('critical');
      expect(member(model, m.id)?.risk.reasons.find((r) => r.code === 'removed-with-callers')?.message ?? 'doğrulanamadı').toContain('doğrulanamadı');
    }
    expect(model.findings.some((f) => f.title.startsWith('Doğrulanamadı (dosya tam ayrıştırılamadı): Silinmiş'))).toBe(true);
    expect(model.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(model.warnings.some((w) => w.includes('doğrulanamadı'))).toBe(true);
  });
});

describe('anotasyonlar yalnız koddan', () => {
  it('yorum ve string içindeki @Ad anotasyon sayılmaz; argümanlı gerçek anotasyon korunur', () => {
    const text = 'void a(@Valid Req r) {\n  // @Async kaldırıldı\n  String q = "@Query(x)"; /* @Transactional */\n  run(@NotNull("a)b") x);\n}';
    expect(maskCommentsAndStrings(text)).toHaveLength(text.length);
    expect(extractCodeAnnotations(text)).toEqual(['@Valid', '@NotNull("a)b")']);
  });

  it('gövdeye eklenen yorum/string anotasyon riski üretmez', () => {
    const before = 'public void run() {\n  work();\n}';
    const after = 'public void run() {\n  // @Async kaldırıldı\n  String s = "@Query(select 1)";\n  work();\n}';
    expect(semanticAnnotationChanges(before, after, [], [])).toEqual([]);
    expect(semanticAnnotationChanges(before, after, [], ['@Async']).map((c) => c.key)).toEqual(['async']);
  });
});

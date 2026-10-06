/**
 * Silinen alan / enum sabiti / record bileşeni için head'de kalan kullanımların aranması (uçtan uca).
 */
import { describe, expect, it } from 'vitest';
import type { ReviewModel } from '../shared/types.js';
import { buildReview } from './buildReview.js';
import { createMemoryChangeSet } from './testing/memoryChangeSet.js';

const P = 'src/main/java/p';
const member = (model: ReviewModel, id: string) => model.types.flatMap((t) => t.members).find((m) => m.id === id);
const findingsOf = (model: ReviewModel, id: string) => model.findings.filter((f) => f.symbolIds?.[0] === id);

describe('silinen alan / enum sabiti / record bileşeni', () => {
  it('enum sabiti silinir, başka dosyada Status.CANCELLED ve case CANCELLED kalır → olası kullanım uyarısı ve risk', async () => {
    const S = (withCancelled: boolean) => `package p;\n\npublic enum Status { NEW, PAID${withCancelled ? ', CANCELLED' : ''} }\n`;
    const cs = createMemoryChangeSet({
      old: { [`${P}/Status.java`]: S(true) },
      new: { [`${P}/Status.java`]: S(false) },
      extraNewFiles: {
        [`${P}/Order.java`]: `package p;

public class Order {
    Status status;

    boolean cancelled() {
        return status == Status.CANCELLED;
    }

    int code() {
        switch (status) {
            case NEW: return 1;
            case CANCELLED: return 3;
            default: return 0;
        }
    }
}
`,
      },
    });
    const model = await buildReview(cs);
    const id = 'p.Status#CANCELLED';
    const f = findingsOf(model, id).find((x) => x.id.startsWith('callers:removed-with-callers:'));
    expect(f?.severity).toBe('warning');
    expect(f?.title).toBe('Silindi ama hâlâ kullanılıyor olabilir: Status.CANCELLED');
    expect(f?.message).toContain(`${P}/Order.java:7`);
    expect(f?.message).toContain(`${P}/Order.java:10`);
    expect(member(model, id)?.risk.reasons.map((r) => r.code)).toContain('removed-with-callers');
    expect(findingsOf(model, id).some((x) => /çağıranı kalmadı/.test(x.message))).toBe(false);
  });

  it('kullanımı kalmayan enum sabiti / statik alan: yanlış alarm yok, bilgiye düşer', async () => {
    const S = (withX: boolean) => `package p;\n\npublic class Limits {\n${withX ? '    public static final int MAX = 10;\n' : ''}    public static final int MIN = 1;\n}\n`;
    const cs = createMemoryChangeSet({
      old: { [`${P}/Limits.java`]: S(true) },
      new: { [`${P}/Limits.java`]: S(false) },
      extraNewFiles: {
        [`${P}/Use.java`]: 'package p;\n\npublic class Use {\n    int a() { return Limits.MIN; }\n    int b(int MAX) { return MAX; }\n}\n',
      },
    });
    const model = await buildReview(cs);
    const id = 'p.Limits#MAX';
    expect(findingsOf(model, id).filter((x) => x.id.startsWith('callers:'))).toEqual([]);
    const api = findingsOf(model, id).find((x) => x.id.startsWith('api:public-api-removed:'));
    expect(api?.severity).toBe('info');
    expect(api?.message).toContain('Repoda kullanımı bulunamadı');
  });

  it('statik alan silinir, başka dosyada Limits.MAX kalır → uyarı', async () => {
    const S = (withX: boolean) => `package p;\n\npublic class Limits {\n${withX ? '    public static final int MAX = 10;\n' : ''}    public static final int MIN = 1;\n}\n`;
    const cs = createMemoryChangeSet({
      old: { [`${P}/Limits.java`]: S(true) },
      new: { [`${P}/Limits.java`]: S(false) },
      extraNewFiles: { [`${P}/Use.java`]: 'package p;\n\npublic class Use {\n    int a() {\n        return Limits.MAX;\n    }\n}\n' },
    });
    const model = await buildReview(cs);
    const f = findingsOf(model, 'p.Limits#MAX').find((x) => x.id.startsWith('callers:removed-with-callers:'));
    expect(f?.severity).toBe('warning');
    expect(f?.message).toContain(`${P}/Use.java:5`);
  });

  it('örnek alanı silinir: kullanım izlenemiyorsa "çağıranı kalmadı" denmez, uyarı kalır', async () => {
    const S = (withX: boolean) => `package p;\n\npublic class Box {\n${withX ? '    public int size;\n' : ''}    public int k() { return 1; }\n}\n`;
    const cs = createMemoryChangeSet({ old: { [`${P}/Box.java`]: S(true) }, new: { [`${P}/Box.java`]: S(false) } });
    const model = await buildReview(cs);
    const api = findingsOf(model, 'p.Box#size').find((x) => x.id.startsWith('api:public-api-removed:'));
    expect(api?.severity).toBe('warning');
    expect(api?.message).toContain('Alan kullanımları otomatik izlenmiyor');
    expect(api?.message).not.toContain('çağıranı kalmadı');
  });

  it('record bileşeni silinir: public API riski; new Money(a, b) ve m.currency() kullanımları bulunur', async () => {
    const R = (withCurrency: boolean) =>
      `package p;\n\nimport java.math.BigDecimal;\n\npublic record Money(BigDecimal amount${withCurrency ? ', String currency' : ''}) {}\n`;
    const cs = createMemoryChangeSet({
      old: { [`${P}/Money.java`]: R(true) },
      new: { [`${P}/Money.java`]: R(false) },
      extraNewFiles: {
        [`${P}/Pay.java`]: `package p;

import java.math.BigDecimal;

public class Pay {
    Money make(BigDecimal a) {
        return new Money(a, "TRY");
    }

    String cur(Money m) {
        return m.currency();
    }
}
`,
      },
    });
    const model = await buildReview(cs);
    const id = 'p.Money#currency';
    const reasons = member(model, id)?.risk.reasons.map((r) => r.code) ?? [];
    expect(reasons).toContain('public-api-removed');
    expect(reasons).toContain('removed-with-callers');
    const f = findingsOf(model, id).find((x) => x.id.startsWith('callers:removed-with-callers:'));
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain(`${P}/Pay.java:7`);
    expect(f?.message).toContain(`${P}/Pay.java:11`);
    expect(model.summary.publicApiChanges).toBeGreaterThanOrEqual(1);
  });

  it('record bileşeni silinir, kullanım yok: yanlış alarm yok', async () => {
    const R = (withCurrency: boolean) => `package p;\n\npublic record Money(long amount${withCurrency ? ', String currency' : ''}) {}\n`;
    const cs = createMemoryChangeSet({
      old: { [`${P}/Money.java`]: R(true) },
      new: { [`${P}/Money.java`]: R(false) },
      extraNewFiles: { [`${P}/Pay.java`]: 'package p;\n\npublic class Pay {\n    Money make() { return new Money(1L); }\n    long a(Money m) { return m.amount(); }\n}\n' },
    });
    const model = await buildReview(cs);
    expect(findingsOf(model, 'p.Money#currency').filter((x) => x.id.startsWith('callers:'))).toEqual([]);
    expect(member(model, 'p.Money#currency')?.risk.reasons.map((r) => r.code)).toContain('public-api-removed');
  });
});

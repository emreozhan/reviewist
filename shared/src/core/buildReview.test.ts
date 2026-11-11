import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReviewModel } from '../shared/types.js';
import { buildReview } from './buildReview.js';
import { createMemoryChangeSet } from './testing/memoryChangeSet.js';
import { createGitTestChangeSet } from './testing/gitChangeSet.js';

const M = 'src/main/java/com/acme/pay';

const PORT_OLD = `package com.acme.pay.application.port.out;

import com.acme.pay.domain.Receipt;

public interface PaymentGateway {
    Receipt charge(String account, long amount);
}
`;
const PORT_NEW = `package com.acme.pay.application.port.out;

import com.acme.pay.domain.Receipt;

public interface PaymentGateway {
    Receipt charge(String account, long amount, String currency);
}
`;
const impl = (name: string, params: string, body: string) => `package com.acme.pay.adapter.out.${name.toLowerCase()};

import com.acme.pay.application.port.out.PaymentGateway;
import com.acme.pay.domain.Receipt;

public class ${name}Gateway implements PaymentGateway {
    @Override
    public Receipt charge(${params}) {
        ${body}
    }
}
`;
const RECEIPT = `package com.acme.pay.domain;

public class Receipt {
    private final String id;

    public Receipt(String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }
}
`;
const CHECKOUT = `package com.acme.pay.application.service;

import com.acme.pay.application.port.out.PaymentGateway;
import com.acme.pay.domain.Receipt;

public class CheckoutService {
    private final PaymentGateway gateway;

    public CheckoutService(PaymentGateway gateway) {
        this.gateway = gateway;
    }

    public Receipt checkout(String account, long amount) {
        return gateway.charge(account, amount);
    }
}
`;

function interfaceScenario() {
  return createMemoryChangeSet({
    old: {
      [`${M}/application/port/out/PaymentGateway.java`]: PORT_OLD,
      [`${M}/adapter/out/stripe/StripeGateway.java`]: impl('Stripe', 'String account, long amount', 'return new Receipt("s-" + account);'),
      [`${M}/adapter/out/paypal/PaypalGateway.java`]: impl('Paypal', 'String account, long amount', 'return new Receipt("p-" + account);'),
    },
    new: {
      [`${M}/application/port/out/PaymentGateway.java`]: PORT_NEW,
      [`${M}/adapter/out/stripe/StripeGateway.java`]: impl('Stripe', 'String account, long amount, String currency', 'return new Receipt("s-" + currency + account);'),
      [`${M}/adapter/out/paypal/PaypalGateway.java`]: impl('Paypal', 'String account, long amount, String currency', 'return new Receipt("p-" + currency + account);'),
    },
    extraNewFiles: {
      [`${M}/domain/Receipt.java`]: RECEIPT,
      [`${M}/application/service/CheckoutService.java`]: CHECKOUT,
      'pom.xml': '<project/>',
    },
  });
}

function step(model: ReviewModel, suffix: string): number {
  const s = model.reviewPlan.find((x) => x.fileId.endsWith(suffix));
  if (!s) throw new Error(`plan adımı yok: ${suffix}`);
  return s.order;
}

describe('buildReview — arayüz imza değişikliği', () => {
  it('implementasyonları, diff dışı çağıranı ve eski arity ile çağrıyı bulur', async () => {
    const progress: string[] = [];
    const model = await buildReview(interfaceScenario(), { id: 't1', onProgress: (m) => progress.push(m) });
    expect(model.id).toBe('t1');
    expect(progress.length).toBeGreaterThan(2);

    const port = model.types.find((t) => t.id === 'com.acme.pay.application.port.out.PaymentGateway');
    expect(port).toBeDefined();
    expect(port?.layer).toBe('port');
    expect([...(port?.subTypes ?? [])].sort()).toEqual([
      'com.acme.pay.adapter.out.paypal.PaypalGateway',
      'com.acme.pay.adapter.out.stripe.StripeGateway',
    ]);
    const charge = port?.members.find((m) => m.name === 'charge');
    expect(charge?.status).toBe('signatureChanged');
    const codes = charge?.risk.reasons.map((r) => r.code) ?? [];
    expect(codes).toContain('public-api-signature');
    expect(codes).toContain('interface-contract');
    expect(codes).toContain('removed-with-callers');
    expect(charge?.risk.level).toBe('critical');
    expect(charge?.overriddenBy.length).toBe(2);

    // Eski arity ile çağıran CheckoutService.checkout → hata bulgusu
    const stale = model.findings.find((f) => f.id.startsWith('callers:removed-with-callers:') && f.symbolIds?.includes(charge?.id ?? ''));
    expect(stale?.severity).toBe('error');
    expect(stale?.message).toContain('CheckoutService.java');
    expect(model.findings[0].severity).toBe('error');

    // Etki grafiği: CheckoutService.checkout diff dışında etkilenen
    const impacted = model.graph.nodes.filter((n) => n.status === 'impacted').map((n) => n.id);
    expect(impacted.some((id) => id.startsWith('com.acme.pay.application.service.CheckoutService#checkout'))).toBe(true);
    expect(model.summary.impactedOutsideDiff).toBeGreaterThanOrEqual(1);
    expect(model.graph.edges.some((e) => e.kind === 'implements' || e.kind === 'overrides')).toBe(true);
    const ids = model.graph.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Plan: arayüz implementasyonlardan önce
    expect(step(model, 'PaymentGateway.java')).toBeLessThan(step(model, 'StripeGateway.java'));
    expect(step(model, 'PaymentGateway.java')).toBeLessThan(step(model, 'PaypalGateway.java'));
    expect(model.reviewPlan[0].reason).toMatch(/^Sözleşme/);
    for (const f of model.files) expect(f.reviewOrder).toBeGreaterThan(0);

    // Gruplama: tek hikâye, imza değişikliği başlığı
    const g = model.groups.find((x) => x.symbolIds.includes(charge?.id ?? ''));
    expect(g?.title).toContain('PaymentGateway.charge imza değişikliği');
    expect(g?.fileIds.length).toBe(3);
    expect(charge?.groupId).toBe(g?.id);

    // Test yok uyarısı (implementasyonların testi yok)
    expect(model.findings.some((f) => f.category === 'test' && f.title.includes('StripeGateway'))).toBe(true);
    expect(model.summary.untestedChanges).toBeGreaterThanOrEqual(2);
    expect(model.summary.publicApiChanges).toBeGreaterThanOrEqual(1);
  });
});

const BASE_OLD = `package com.acme.notify;

public abstract class AbstractNotifier {
    public final void send(String to, String text) {
        String body = format(text);
        deliver(to, body);
    }

    protected abstract String format(String text);

    protected abstract void deliver(String to, String body);
}
`;
const BASE_NEW = `package com.acme.notify;

public abstract class AbstractNotifier {
    public final void send(String to, String text) {
        if (to == null || to.isBlank()) {
            return;
        }
        String body = format(text.trim());
        deliver(to, body);
        audit(to);
    }

    protected abstract String format(String text);

    protected abstract void deliver(String to, String body);

    protected void audit(String to) {
    }
}
`;
const sub = (name: string) => `package com.acme.notify;

public class ${name}Notifier extends AbstractNotifier {
    @Override
    protected String format(String text) {
        return "[${name}] " + text;
    }

    @Override
    protected void deliver(String to, String body) {
        System.err.println(to + body);
    }
}
`;

describe('buildReview — template method', () => {
  it('alt sınıfları impacted olarak işaretler ve şablon metot riskini verir', async () => {
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/com/acme/notify/AbstractNotifier.java': BASE_OLD },
      new: { 'src/main/java/com/acme/notify/AbstractNotifier.java': BASE_NEW },
      extraNewFiles: {
        'src/main/java/com/acme/notify/EmailNotifier.java': sub('Email'),
        'src/main/java/com/acme/notify/SmsNotifier.java': sub('Sms'),
      },
    });
    const model = await buildReview(cs);
    const base = model.types.find((t) => t.name === 'AbstractNotifier');
    const send = base?.members.find((m) => m.name === 'send');
    expect(send?.status).toBe('modified');
    expect(send?.risk.reasons.map((r) => r.code)).toContain('template-method');
    const impacted = model.graph.nodes.filter((n) => n.status === 'impacted').map((n) => n.id);
    expect(impacted).toContain('com.acme.notify.EmailNotifier');
    expect(impacted).toContain('com.acme.notify.SmsNotifier');
    expect(model.graph.edges.some((e) => e.kind === 'extends' && e.from === 'com.acme.notify.EmailNotifier')).toBe(true);
    expect(model.findings.some((f) => f.category === 'inheritance' && f.title.includes('Şablon metot'))).toBe(true);
    expect(model.reviewPlan[0].reason).toMatch(/^Temel sınıf/);
  });
});

describe('buildReview — silinmiş ama çağrılan, kozmetik dosya, java dışı', () => {
  it('silinen metodun çağıranını, kozmetik dosyayı (sona) ve yapılandırma riskini raporlar', async () => {
    const utilOld = `package com.acme.common;

public final class Money {
    public static long toCents(double amount) {
        return Math.round(amount * 100);
    }

    public static long legacyCents(double amount) {
        return (long) (amount * 100);
    }
}
`;
    const utilNew = `package com.acme.common;

public final class Money {
    public static long toCents(double amount) {
        return Math.round(amount * 100);
    }
}
`;
    const user = `package com.acme.billing;

import com.acme.common.Money;

public class Invoice {
    public long total(double amount) {
        return Money.legacyCents(amount);
    }
}
`;
    const cosmeticOld = `package com.acme.billing;

public class Tax {
    public double rate() { return 0.18; }
}
`;
    const cosmeticNew = `package com.acme.billing;

/**
 * Vergi oranı.
 */
public class Tax {

    public double rate() {
        return 0.18;
    }
}
`;
    const cs = createMemoryChangeSet({
      old: {
        'src/main/java/com/acme/common/Money.java': utilOld,
        'src/main/java/com/acme/billing/Tax.java': cosmeticOld,
        'src/main/resources/application.yml': 'server:\n  port: 8080\n',
        'src/main/resources/db/migration/V1__init.sql': 'create table a(id int);\n',
      },
      new: {
        'src/main/java/com/acme/common/Money.java': utilNew,
        'src/main/java/com/acme/billing/Tax.java': cosmeticNew,
        'src/main/resources/application.yml': 'server:\n  port: 9090\n',
        'src/main/resources/db/migration/V1__init.sql': 'create table a(id int);\n',
        'src/main/resources/db/migration/V2__more.sql': 'alter table a add b int;\n',
      },
      extraNewFiles: { 'src/main/java/com/acme/billing/Invoice.java': user },
    });
    const model = await buildReview(cs);
    const money = model.types.find((t) => t.name === 'Money');
    const legacy = money?.members.find((m) => m.name === 'legacyCents');
    expect(legacy?.status).toBe('removed');
    expect(legacy?.risk.level).toBe('critical');
    const f = model.findings.find((x) => x.category === 'callers' && x.severity === 'error');
    expect(f?.title).toContain('Money.legacyCents');
    expect(f?.message).toContain('Invoice.java');

    const tax = model.files.find((x) => x.path.endsWith('Tax.java'));
    expect(tax?.cosmeticOnly).toBe(true);
    expect(tax?.risk.score).toBe(0);
    expect(model.reviewPlan[model.reviewPlan.length - 1].fileId).toBe(tax?.path);
    expect(model.groups.find((g) => g.id === 'group:cosmetic')?.fileIds).toContain(tax?.path);
    expect(model.findings.some((x) => x.id === 'cosmetic:files')).toBe(true);
    expect(model.summary.cosmeticFiles).toBe(1);

    const yml = model.files.find((x) => x.path.endsWith('application.yml'));
    expect(yml?.layer).toBe('resource');
    expect(yml?.risk.level).toBe('medium');
    const sql = model.files.find((x) => x.path.endsWith('V2__more.sql'));
    expect(sql?.risk.level).toBe('high');
  });

  it('içerik okunamazsa dosyayı korur ve uyarı ekler', async () => {
    const base = createMemoryChangeSet({
      old: { 'src/main/java/a/A.java': 'package a;\nclass A { void f() {} }\n' },
      new: { 'src/main/java/a/A.java': 'package a;\nclass A { void f() { int x = 1; } }\n' },
    });
    const cs = { ...base, readFile: async () => undefined, listFiles: async () => [] };
    const model = await buildReview(cs);
    expect(model.files).toHaveLength(1);
    expect(model.files[0].hunks.length).toBeGreaterThan(0);
    expect(model.warnings.some((w) => w.includes('içeriği alınamadı'))).toBe(true);
    expect(model.findings.some((f) => f.id === 'other:unanalyzed:src/main/java/a/A.java')).toBe(true);
  });

  it('bozuk Java tüm review\'u patlatmaz', async () => {
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/a/B.java': 'package a;\nclass B { void f() {} }\n' },
      new: { 'src/main/java/a/B.java': 'package a;\nclass B { void f( { }\n' },
    });
    const model = await buildReview(cs);
    expect(model.files[0].parseError).toBeDefined();
    expect(model.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Fikstür: fixtures/sample-repo, main...feature/ai-refactor
// ---------------------------------------------------------------------------

const FIXTURE = join(process.cwd(), 'fixtures', 'sample-repo');
const EXPECTED = join(process.cwd(), 'fixtures', 'EXPECTED.md');
const hasFixture = existsSync(join(FIXTURE, '.git')) && existsSync(EXPECTED);

describe('buildReview — fikstür', () => {
  it.skipIf(!hasFixture)('main...feature/ai-refactor beklentileri', async () => {
    const cs = await createGitTestChangeSet(FIXTURE, 'main', 'feature/ai-refactor');
    const started = Date.now();
    const model = await buildReview(cs, { id: 'fixture' });
    const ms = Date.now() - started;
    console.log(`[fikstür] buildReview ${ms} ms; ${model.summary.files} dosya, ${model.findings.length} bulgu, ${model.graph.nodes.length} düğüm`);
    console.log(`[fikstür] summary ${JSON.stringify(model.summary)}`);
    for (const s of model.reviewPlan.slice(0, 10)) console.log(`[plan] ${s.order}. ${s.fileId} — ${s.reason}`);
    for (const f of model.findings.slice(0, 10)) console.log(`[bulgu] ${f.severity} ${f.category} ${f.title}`);
    for (const w of model.warnings) console.log(`[uyarı] ${w}`);

    const expected = readFileSync(EXPECTED, 'utf8');
    expect(model.files.length).toBeGreaterThan(0);
    expect(model.summary.javaFiles).toBeGreaterThan(0);
    // Ayrıntılı beklentiler EXPECTED.md'den fixtureExpectations ile kontrol edilir
    const { checkFixtureExpectations } = await import('./testing/fixtureExpectations.js');
    const problems = checkFixtureExpectations(model, expected);
    expect(problems).toEqual([]);
  });
});

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CallRef, ReviewModel } from '../shared/types.js';
import { dedupeCallers } from './analysis/enrich.js';
import { progressCounter } from './analysis/util.js';
import { buildReview } from './buildReview.js';
import { diffJavaFile, parseJavaFile } from './java/index.js';
import { createGitTestChangeSet } from './testing/gitChangeSet.js';
import { createMemoryChangeSet } from './testing/memoryChangeSet.js';

const member = (model: ReviewModel, id: string) => model.types.flatMap((t) => t.members).find((m) => m.id === id);

describe('semanticDiff — supertypes bayrağı', () => {
  it('extends/implements değişince eklenir; arayüz sırası değişince eklenmez', async () => {
    const o = await parseJavaFile('A.java', 'package p;\npublic class A implements Foo, Bar {}\n');
    const reordered = await parseJavaFile('A.java', 'package p;\npublic class A implements Bar, Foo {}\n');
    const changed = await parseJavaFile('A.java', 'package p;\npublic class A extends Base implements Foo, Bar {}\n');
    expect(diffJavaFile(o, reordered)[0].change.flags).not.toContain('supertypes');
    const d = diffJavaFile(o, changed)[0].change;
    expect(d.flags).toContain('supertypes');
    expect(d.status).toBe('signatureChanged');
  });

  it('risk: basit ad aynı ama çözülen üst tip başka paketteyse kalıtım değişti sayılır', async () => {
    const foo = (pkg: string) => `package ${pkg};\npublic interface Foo { void run(); }\n`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/p/A.java': 'package p;\npublic class A implements q1.Foo {\n    public void run() {}\n}\n' },
      new: { 'src/main/java/p/A.java': 'package p;\npublic class A implements q2.Foo {\n    public void run() {}\n}\n' },
      extraNewFiles: { 'src/main/java/q1/Foo.java': foo('q1'), 'src/main/java/q2/Foo.java': foo('q2') },
    });
    const model = await buildReview(cs);
    const a = model.types.find((t) => t.id === 'p.A');
    expect(a?.flags).toContain('supertypes');
    expect(a?.risk.reasons.map((r) => r.code)).toContain('supertypes-changed');
  });
});

describe('enrich — çağıran tekrarları', () => {
  it('aynı (fromId, line) teke iner, en yüksek güven kalır', () => {
    const c = (confidence: CallRef['confidence'], line = 3, fromId = 'a.B#x()'): CallRef => ({ fromId, file: 'B.java', line, inChangedCode: false, confidence });
    const out = dedupeCallers([c('likely'), c('name-only', 4), c('exact'), c('likely', 4), c('exact', 3, 'a.C#y()')]);
    expect(out).toHaveLength(3);
    expect(out.find((x) => x.fromId === 'a.B#x()' && x.line === 3)?.confidence).toBe('exact');
    expect(out.find((x) => x.line === 4)?.confidence).toBe('likely');
  });

  it('arayüz üzerinden ve doğrudan çağrı aynı satıra düşmez', async () => {
    const PORT = (p: string) => `package app;\npublic interface Port {\n    void send(${p});\n}\n`;
    const IMPL = (p: string) => `package app;\npublic class Impl implements Port {\n    @Override\n    public void send(${p}) {}\n}\n`;
    const USER = `package app;\npublic class User {\n    private final Impl impl = new Impl();\n    private final Port port = impl;\n    void go() {\n        impl.send("a");\n        port.send("b");\n    }\n}\n`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/app/Port.java': PORT('String s'), 'src/main/java/app/Impl.java': IMPL('String s') },
      new: { 'src/main/java/app/Port.java': PORT('String s'), 'src/main/java/app/Impl.java': IMPL('String s').replace('{}', '{ System.out.println(s); }') },
      extraNewFiles: { 'src/main/java/app/User.java': USER },
    });
    const model = await buildReview(cs);
    const send = member(model, 'app.Impl#send(String)');
    const keys = send?.callers.map((c) => `${c.fromId}|${c.line}`) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    expect(send?.callers.find((c) => c.line === 6)?.confidence).toBe('exact');
  });
});

describe('enrich — parametre tipi değişen metot (aynı ad + arity)', () => {
  const REPO = (param: string) => `package com.acme.order;

public class OrderRepository {
    public Order find(${param} id) {
        return null;
    }
}
`;
  const LOOKUP = `package com.acme.app;

import com.acme.order.*;

public class Lookup {
    private final OrderRepository repo = new OrderRepository();
    public Order a() { return repo.find("A-1"); }
    public Order b(String raw) { return repo.find(raw); }
    public Order c(OrderId id) { return repo.find(id); }
    public Order d() { return repo.find(compute()); }
    public Order e() { return repo.find(new OrderId("x")); }
    private OrderId compute() { return new OrderId("x"); }
}
`;
  it('çıkarılabilen uyumsuz argümanları likely bayat çağrı olarak bildirir, diğerlerinde sessiz kalır', async () => {
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/com/acme/order/OrderRepository.java': REPO('String') },
      new: { 'src/main/java/com/acme/order/OrderRepository.java': REPO('OrderId') },
      extraNewFiles: {
        'src/main/java/com/acme/app/Lookup.java': LOOKUP,
        'src/main/java/com/acme/order/Order.java': 'package com.acme.order;\npublic class Order {}\n',
        'src/main/java/com/acme/order/OrderId.java': 'package com.acme.order;\npublic record OrderId(String value) {}\n',
      },
    });
    const model = await buildReview(cs);
    const find = member(model, 'com.acme.order.OrderRepository#find(OrderId)');
    expect(find?.status).toBe('signatureChanged');
    const reason = find?.risk.reasons.find((r) => r.code === 'removed-with-callers');
    expect(reason?.message).toContain('Lookup.java:7');
    expect(reason?.message).toContain('Lookup.java:8');
    expect(reason?.message).toContain('2 yerde');
    expect(reason?.message).toContain('argüman tipleri');
    const finding = model.findings.find((f) => f.id.startsWith('callers:removed-with-callers:') && f.symbolIds?.includes(find?.id ?? ''));
    expect(finding?.message).not.toMatch(/Lookup\.java:(9|10|11)\b/);
  });

  it('genişletme/kutulama ile uyan argümanlar bayat sayılmaz', async () => {
    const R = (p: string) => `package q;\npublic class Calc {\n    public long twice(${p} x) { return x * 2; }\n}\n`;
    const U = `package q;\npublic class Use {\n    private final Calc c = new Calc();\n    long a() { return c.twice(3); }\n    long b(Integer n) { return c.twice(n); }\n    long z() { return c.twice(true); }\n}\n`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/q/Calc.java': R('int') },
      new: { 'src/main/java/q/Calc.java': R('long') },
      extraNewFiles: { 'src/main/java/q/Use.java': U },
    });
    const model = await buildReview(cs);
    const twice = member(model, 'q.Calc#twice(long)');
    expect(twice?.status).toBe('signatureChanged');
    // Yalnızca boolean argümanlı satır (6) bayat; int literal (4) ve Integer (5) long'a uyar.
    const reason = twice?.risk.reasons.find((r) => r.code === 'removed-with-callers');
    expect(reason?.message).toContain('Use.java:6');
    expect(reason?.message).toContain('1 yerde');
  });
});

describe('graph — aralıklar ve test katmanı', () => {
  const CALC = (body: string, extra = '') => `package com.acme.calc;

public class Calculator {
    public int add(int a, int b) {
        ${body}
    }
${extra}
}
`;
  it('her düğüm range/rangeSide taşır; diff dışı test düğümü bir kademe düşük risklidir', async () => {
    const PROD_USER = `package com.acme.calc;

public class Billing {
    public int total(Calculator c) {
        return c.add(1, 2);
    }
}
`;
    const TEST_USER = `package com.acme.calc;

class CalculatorTest {
    void shouldAdd() {
        new Calculator().add(1, 2);
    }
}
`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/com/acme/calc/Calculator.java': CALC('return a + b;', '    public int legacy() { return 0; }\n') },
      new: { 'src/main/java/com/acme/calc/Calculator.java': CALC('return Math.addExact(a, b);') },
      extraNewFiles: { 'src/main/java/com/acme/calc/Billing.java': PROD_USER, 'src/test/java/com/acme/calc/CalculatorTest.java': TEST_USER },
    });
    const model = await buildReview(cs);
    const nodes = new Map(model.graph.nodes.map((n) => [n.id, n]));
    for (const n of model.graph.nodes) {
      expect(n.range, n.id).toBeDefined();
      expect(n.rangeSide, n.id).toBeDefined();
    }
    const add = nodes.get('com.acme.calc.Calculator#add(int,int)');
    expect(add).toMatchObject({ range: { startLine: 4, endLine: 6 }, rangeSide: 'new' });
    const legacy = nodes.get('com.acme.calc.Calculator#legacy()');
    expect(legacy).toMatchObject({ status: 'removed', rangeSide: 'old', range: { startLine: 7, endLine: 7 } });
    const prod = nodes.get('com.acme.calc.Billing#total(Calculator)');
    const test = nodes.get('com.acme.calc.CalculatorTest#shouldAdd()');
    expect(prod).toMatchObject({ status: 'impacted', range: { startLine: 4, endLine: 6 }, rangeSide: 'new' });
    expect(test).toMatchObject({ status: 'impacted', layer: 'test', range: { startLine: 4, endLine: 6 }, rangeSide: 'new' });
    const order = ['low', 'medium', 'high', 'critical'];
    const prodLevel = order.indexOf(prod?.riskLevel ?? 'low');
    expect(order.indexOf(test?.riskLevel ?? 'low')).toBe(Math.max(0, prodLevel - 1));
  });
});

describe('buildReview — ilerleme mesajları', () => {
  it('sayısal ve seyrek; küçük toplamlarda her aşama görünür', async () => {
    const old: Record<string, string> = {};
    const nw: Record<string, string> = {};
    const extra: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      old[`src/main/java/p/C${i}.java`] = `package p;\npublic class C${i} {\n    int f() { return ${i}; }\n}\n`;
      nw[`src/main/java/p/C${i}.java`] = `package p;\npublic class C${i} {\n    int f() { return ${i + 1}; }\n}\n`;
    }
    for (let i = 0; i < 300; i++) extra[`src/main/java/q/D${i}.java`] = `package q;\npublic class D${i} {}\n`;
    const msgs: string[] = [];
    await buildReview(createMemoryChangeSet({ old, new: nw, extraNewFiles: extra }), { onProgress: (m) => msgs.push(m) });
    expect(msgs).toContain('Değişen dosyalar okunuyor (40/40)');
    expect(msgs).toContain('Java ayrıştırılıyor (40/40 dosya)');
    expect(msgs).toContain('Repo indeksi: 340/340 dosya');
    expect(msgs.some((m) => m.startsWith('Çağrı grafiği kuruluyor'))).toBe(true);
    expect(msgs).toContain('Risk ve mimari analiz');
    expect(msgs.some((m) => m.startsWith('Okuma planı'))).toBe(true);
    expect(msgs[msgs.length - 1]).toMatch(/^Analiz tamamlandı/);
    for (const prefix of ['Değişen dosyalar okunuyor', 'Java ayrıştırılıyor', 'Repo indeksi:']) {
      expect(msgs.filter((m) => m.startsWith(prefix)).length, prefix).toBeLessThanOrEqual(12);
    }
  });

  it('progressCounter: ~%10 adım, başlangıç ve son mesajı', () => {
    const out: string[] = [];
    const c = progressCounter((m) => out.push(m), 1000, (d, t) => `${d}/${t}`, 200);
    for (let i = 0; i < 800; i++) c.tick();
    expect(out[0]).toBe('200/1000');
    expect(out[out.length - 1]).toBe('1000/1000');
    expect(out.length).toBeLessThanOrEqual(10);
    const small: string[] = [];
    const s = progressCounter((m) => small.push(m), 3, (d, t) => `${d}/${t}`);
    s.tick();
    s.tick();
    s.tick();
    expect(small).toEqual(['0/3', '1/3', '2/3', '3/3']);
  });
});

const FIXTURE = join(process.cwd(), 'fixtures', 'sample-repo');
const hasFixture = existsSync(join(FIXTURE, '.git'));

describe.skipIf(!hasFixture)('fikstür — tur 2', () => {
  it('taşıma ayrı hikâye; PaymentGateway hikâyesi küçülür; graf aralıkları dolu', { timeout: 60_000 }, async () => {
    const cs = await createGitTestChangeSet(FIXTURE, 'main', 'feature/ai-refactor');
    const model = await buildReview(cs);
    const S = 'com.acme.shop';
    const moved = model.groups.find((g) => g.symbolIds.includes(`${S}.domain.service.OrderValidator#validate(PlaceOrderCommand)`));
    expect(moved?.title).toMatch(/^validate PlaceOrderService → OrderValidator taşındı/);
    expect(moved?.symbolIds.some((id) => id.includes('PaymentGateway'))).toBe(false);
    // testler grubun sonunda
    const firstTest = moved?.symbolIds.findIndex((id) => id.includes('Test#')) ?? -1;
    expect(firstTest).toBeGreaterThan(0);
    expect(moved?.symbolIds.slice(firstTest).every((id) => id.includes('Test#'))).toBe(true);

    const pay = model.groups.find((g) => g.symbolIds.includes(`${S}.application.port.out.PaymentGateway#charge(Money,String)`));
    expect(pay?.title).toContain('PaymentGateway.charge imza değişikliği');
    expect(pay?.fileIds.some((f) => f.includes('OrderValidator'))).toBe(false);
    expect(pay?.symbolIds.length).toBeLessThanOrEqual(8);

    for (const n of model.graph.nodes) expect(n.range, n.id).toBeDefined();
    for (const n of model.graph.nodes.filter((x) => x.status === 'impacted' && x.layer === 'test')) {
      expect(['low', 'medium', 'high']).toContain(n.riskLevel);
    }
    for (const t of model.types) {
      for (const m of t.members) {
        const keys = m.callers.map((c) => `${c.fromId}|${c.line}`);
        expect(new Set(keys).size, m.id).toBe(keys.length);
      }
    }
  });
});

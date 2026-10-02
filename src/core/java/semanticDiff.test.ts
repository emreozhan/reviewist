import { describe, expect, it } from 'vitest';
import { parseJavaFile } from './extract.js';
import type { MemberDiff, TypeDiff } from './model.js';
import { detectCrossFileMoves, diffJavaFile, memberSimilarity } from './semanticDiff.js';

async function diff(oldSrc: string | undefined, newSrc: string | undefined, path = 'A.java'): Promise<TypeDiff[]> {
  const o = oldSrc === undefined ? undefined : await parseJavaFile(path, oldSrc);
  const n = newSrc === undefined ? undefined : await parseJavaFile(path, newSrc);
  return diffJavaFile(o, n, { oldPath: path, newPath: path });
}

function td(diffs: TypeDiff[], id: string): TypeDiff {
  const t = diffs.find((d) => d.change.id === id);
  if (!t) throw new Error(`tip diff yok: ${id} (var: ${diffs.map((d) => d.change.id).join(', ')})`);
  return t;
}

function md(t: TypeDiff, id: string): MemberDiff {
  const m = t.members.find((x) => x.change.id === id);
  if (!m) throw new Error(`üye diff yok: ${id} (var: ${t.members.map((x) => `${x.change.id}:${x.change.status}`).join(', ')})`);
  return m;
}

const BASE = `package com.acme;

import java.util.List;

/** Servis. */
public class OrderService {
    private int count = 0;

    /** Toplam. */
    public int getTotal(List<Order> orders) {
        int sum = 0;
        for (Order o : orders) {
            sum += o.amount();
        }
        return sum;
    }

    public Order place(Order order, int qty) {
        validate(order);
        return order;
    }

    public void cancel(String id) {
        repo.delete(id);
    }

    void audit(String msg) {
        System.out.println(msg);
    }

    private void validate(Order order) {
        if (order == null) {
            throw new IllegalArgumentException("order");
        }
    }
}
`;

describe('diffJavaFile: üye durumları', () => {
  it('aynı dosya → tüm tip ve üyeler unchanged; members referansları aynı', async () => {
    const d = await diff(BASE, BASE);
    const t = td(d, 'com.acme.OrderService');
    expect(t.change.status).toBe('unchanged');
    expect(t.change.details).toEqual([]);
    expect(t.members.every((m) => m.change.status === 'unchanged')).toBe(true);
    expect(t.change.members.length).toBe(t.members.length);
    t.members.forEach((m, i) => expect(t.change.members[i]).toBe(m.change));
    expect(t.change.risk).toEqual({ score: 0, level: 'low', reasons: [] });
    expect(t.change.layer).toBe('other');
    expect(t.members[0]?.change.callers).toEqual([]);
  });

  it('yeniden girintileme + yorum değişikliği → cosmetic (formatting), gerçek satır sayıları', async () => {
    const reindented = BASE.replace(/^ {4}/gm, '\t').replace('return sum;', 'return sum; // sonuç');
    const d = await diff(BASE, reindented);
    const t = td(d, 'com.acme.OrderService');
    expect(t.change.status).toBe('cosmetic');
    expect(t.change.flags).toContain('formatting');
    const total = md(t, 'com.acme.OrderService#getTotal(List)').change;
    expect(total.status).toBe('cosmetic');
    expect(total.flags).toEqual(['formatting']);
    expect(total.details).toEqual(['yalnızca biçim/boşluk']);
    expect(total.linesAdded).toBeGreaterThan(0);
    expect(total.linesRemoved).toBe(total.linesAdded);
    // tek satırlık alan: yalnızca girinti değişti
    expect(md(t, 'com.acme.OrderService#count').change.status).toBe('cosmetic');
  });

  it('yalnızca javadoc → cosmetic + javadoc', async () => {
    const d = await diff(BASE, BASE.replace('/** Toplam. */', '/**\n     * Siparişlerin toplamı.\n     */'));
    const c = md(td(d, 'com.acme.OrderService'), 'com.acme.OrderService#getTotal(List)').change;
    expect(c.status).toBe('cosmetic');
    expect(c.flags).toEqual(['javadoc']);
    expect(c.details).toEqual(['yalnızca javadoc']);
    expect(c.linesAdded).toBe(3);
    expect(c.linesRemoved).toBe(1);
  });

  it('gövde değişikliği → modified (body, satır ve karmaşıklık ayrıntısı)', async () => {
    const d = await diff(
      BASE,
      BASE.replace('validate(order);\n', 'validate(order);\n        if (qty > 10) {\n            audit("büyük");\n        }\n'),
    );
    const c = md(td(d, 'com.acme.OrderService'), 'com.acme.OrderService#place(Order,int)').change;
    expect(c.status).toBe('modified');
    expect(c.flags).toEqual(['body']);
    expect(c.details).toEqual(['gövde değişti (+3/−0 satır)', 'karmaşıklık 1 → 2']);
    expect(c.linesAdded).toBe(3);
    expect(c.linesRemoved).toBe(0);
    expect(c.oldRange).toEqual({ startLine: 18, endLine: 21 });
    expect(c.newRange).toEqual({ startLine: 18, endLine: 24 });
    expect(td(d, 'com.acme.OrderService').change.status).toBe('modified');
  });

  it('annotation ekleme → signatureChanged (annotations)', async () => {
    const d = await diff(BASE, BASE.replace('    public void cancel', '    @Transactional\n    public void cancel'));
    const c = md(td(d, 'com.acme.OrderService'), 'com.acme.OrderService#cancel(String)').change;
    expect(c.status).toBe('signatureChanged');
    expect(c.flags).toEqual(['annotations']);
    expect(c.details).toEqual(['@Transactional eklendi']);
  });

  it('annotation kaldırma ve argüman değişikliği ayrıntıları', async () => {
    const o = BASE.replace('    public void cancel', '    @Deprecated\n    @Timed(1)\n    public void cancel');
    const n = BASE.replace('    public void cancel', '    @Timed(2)\n    public void cancel');
    const c = md(td(await diff(o, n), 'com.acme.OrderService'), 'com.acme.OrderService#cancel(String)').change;
    expect(c.status).toBe('signatureChanged');
    expect(c.details).toEqual(['@Timed değişti: @Timed(1) → @Timed(2)', '@Deprecated kaldırıldı']);
  });

  it('görünürlük, parametre ekleme, dönüş tipi, throws → signatureChanged + ayrıntılar', async () => {
    const n = BASE.replace(
      'public Order place(Order order, int qty) {',
      'private Optional<Order> place(Order order, long qty, String idempotencyKey) throws IOException {',
    ).replace('return order;\n    }\n\n    public void cancel', 'return Optional.of(order);\n    }\n\n    public void cancel');
    const d = await diff(BASE, n);
    const c = md(td(d, 'com.acme.OrderService'), 'com.acme.OrderService#place(Order,long,String)').change;
    expect(c.status).toBe('signatureChanged');
    expect(c.oldId).toBe('com.acme.OrderService#place(Order,int)');
    expect(c.oldSignature).toBe('public Order place(Order order, int qty)');
    expect(c.signature).toBe('private Optional<Order> place(Order order, long qty, String idempotencyKey) throws IOException');
    expect(c.flags).toEqual(['visibility', 'params', 'returnType', 'throws', 'body']);
    expect(c.details).toEqual([
      'görünürlük: public → private',
      'parametre eklendi: String idempotencyKey',
      'parametre tipi: int → long (qty)',
      'dönüş tipi: Order → Optional<Order>',
      'throws eklendi: IOException',
      'gövde değişti (+2/−2 satır)',
    ]);
  });

  it('alan tipi ve başlatıcı değişikliği', async () => {
    const d = await diff(BASE, BASE.replace('private int count = 0;', 'private long count = 1;'));
    const c = md(td(d, 'com.acme.OrderService'), 'com.acme.OrderService#count').change;
    expect(c.status).toBe('signatureChanged');
    expect(c.flags).toEqual(['fieldType', 'initializer']);
    expect(c.details).toEqual(['alan tipi: int → long', 'başlatıcı değişti: 0 → 1']);
    const d2 = await diff(BASE, BASE.replace('private int count = 0;', 'private int count = 5;'));
    const c2 = md(td(d2, 'com.acme.OrderService'), 'com.acme.OrderService#count').change;
    expect(c2.status).toBe('modified');
    expect(c2.flags).toEqual(['initializer']);
  });

  it('ad değişikliği, gövde aynı → renamed (oldId/oldName)', async () => {
    const d = await diff(BASE, BASE.replace('public int getTotal(', 'public int totalAmount('));
    const c = md(td(d, 'com.acme.OrderService'), 'com.acme.OrderService#totalAmount(List)').change;
    expect(c.status).toBe('renamed');
    expect(c.oldId).toBe('com.acme.OrderService#getTotal(List)');
    expect(c.oldName).toBe('getTotal');
    expect(c.details).toEqual(['ad değişti: getTotal → totalAmount']);
    expect(td(d, 'com.acme.OrderService').members.some((m) => m.change.status === 'removed')).toBe(false);
  });

  it('eklenen / kaldırılan üyeler ve kaldırılanın sırası korunur', async () => {
    const n = BASE.replace(
      /\n {4}void audit\(String msg\) \{\n {8}System\.out\.println\(msg\);\n {4}\}\n/,
      '\n    public boolean isEmpty() {\n        return count == 0;\n    }\n',
    );
    const t = td(await diff(BASE, n), 'com.acme.OrderService');
    expect(md(t, 'com.acme.OrderService#isEmpty()').change).toMatchObject({ status: 'added', linesAdded: 3, linesRemoved: 0 });
    const removed = md(t, 'com.acme.OrderService#audit(String)');
    expect(removed.change).toMatchObject({ status: 'removed', linesAdded: 0, linesRemoved: 3 });
    expect(removed.oldMember?.name).toBe('audit');
    expect(removed.change.oldRange).toEqual({ startLine: 27, endLine: 29 });
    const ids = t.members.map((m) => m.change.id);
    expect(ids.indexOf('com.acme.OrderService#audit(String)')).toBeGreaterThan(ids.indexOf('com.acme.OrderService#cancel(String)'));
    expect(t.change.details).toContain('üyeler: 1 eklendi, 1 kaldırıldı');
  });

  it('aşırı yükleme belirsizliği: parametre benzerliğiyle doğru eşleşme', async () => {
    const o = `class R {
  Order find(int id) { return byId(id); }
  Order find(String code) { return byCode(code); }
}
`;
    const n = `class R {
  Order find(long id) { return byId(id); }
  Order find(String code, boolean strict) { return byCode(code); }
}
`;
    const t = td(await diff(o, n), 'R');
    const a = md(t, 'R#find(long)').change;
    expect(a.status).toBe('signatureChanged');
    expect(a.oldId).toBe('R#find(int)');
    expect(a.details).toContain('parametre tipi: int → long (id)');
    const b = md(t, 'R#find(String,boolean)').change;
    expect(b.status).toBe('signatureChanged');
    expect(b.oldId).toBe('R#find(String)');
    expect(b.details).toContain('parametre eklendi: boolean strict');
    expect(t.members.some((m) => m.change.status === 'added' || m.change.status === 'removed')).toBe(false);
  });

  it('kısa/önemsiz gövdeler çoklu adayda renamed sayılmaz', async () => {
    const o = 'class S {\n  void a() {}\n  void b() {}\n}\n';
    const n = 'class S {\n  void c() {}\n  void d() {}\n}\n';
    const t = td(await diff(o, n), 'S');
    expect(t.members.map((m) => m.change.status).sort()).toEqual(['added', 'added', 'removed', 'removed']);
  });

  it('eklenen ve silinen dosya: tüm tip/üyeler added/removed', async () => {
    const added = await diff(undefined, BASE);
    expect(added[0]?.change.status).toBe('added');
    expect(added[0]?.members.every((m) => m.change.status === 'added' && m.newMember && !m.oldMember)).toBe(true);
    expect(added[0]?.oldType).toBeUndefined();
    const removed = await diff(BASE, undefined);
    expect(removed[0]?.change.status).toBe('removed');
    expect(removed[0]?.members.every((m) => m.change.status === 'removed')).toBe(true);
    expect(removed[0]?.change.newRange).toBeUndefined();
  });
});

describe('diffJavaFile: tip düzeyi', () => {
  it('tip başlığı: üst sınıf, implements, abstract, annotation → signatureChanged', async () => {
    const o = 'package p;\n@Service\npublic class A extends Base implements Foo {\n  void x() {}\n}\n';
    const n = 'package p;\n@Component\npublic abstract class A extends Other implements Foo, Bar<String> {\n  void x() {}\n}\n';
    const t = td(await diff(o, n), 'p.A');
    expect(t.change.status).toBe('signatureChanged');
    expect(t.change.flags).toEqual(['modifiers', 'annotations', 'supertypes']);
    expect(t.change.details).toEqual([
      'abstract oldu',
      '@Component eklendi',
      '@Service kaldırıldı',
      'üst sınıf: Base → Other',
      'implements eklendi: Bar',
    ]);
    expect(t.change.superTypes).toEqual(['Other', 'Foo', 'Bar']);
    expect(t.change.oldSuperTypes).toEqual(['Base', 'Foo']);
  });

  it('tip yeniden adlandırma (aynı paket) → renamed; yapıcı ve üyeler eşleşir', async () => {
    const o = 'package p;\npublic class OrderHelper {\n  OrderHelper() {}\n  int sum(int a, int b) { return a + b; }\n  int mul(int a, int b) { return a * b; }\n}\n';
    const n = o.replace(/OrderHelper/g, 'OrderMath');
    const d = await diff(o, n);
    expect(d.length).toBe(1);
    const t = td(d, 'p.OrderMath');
    expect(t.change.status).toBe('renamed');
    expect(t.change.oldId).toBe('p.OrderHelper');
    expect(t.change.details[0]).toBe('ad değişti: OrderHelper → OrderMath');
    const sum = md(t, 'p.OrderMath#sum(int,int)').change;
    expect(sum.status).toBe('unchanged');
    expect(sum.oldId).toBe('p.OrderHelper#sum(int,int)');
    expect(md(t, 'p.OrderMath#OrderMath()').change.oldId).toBe('p.OrderHelper#OrderHelper()');
  });

  it('paket değişikliği (dosya yeniden adlandırma) → moved, iç tip dahil', async () => {
    const o = 'package a.web;\npublic class Req {\n  String id;\n  String id() { return id; }\n  static class Line { int q; int q() { return q; } }\n}\n';
    const n = o.replace('package a.web;', 'package a.web.dto;');
    const om = await parseJavaFile('a/web/Req.java', o);
    const nm = await parseJavaFile('a/web/dto/Req.java', n);
    const d = diffJavaFile(om, nm, { oldPath: 'a/web/Req.java', newPath: 'a/web/dto/Req.java' });
    const t = td(d, 'a.web.dto.Req');
    expect(t.change.status).toBe('moved');
    expect(t.change.oldId).toBe('a.web.Req');
    expect(t.change.file).toBe('a/web/dto/Req.java');
    expect(t.change.details[0]).toBe('paket değişti: a.web → a.web.dto');
    expect(t.members.every((m) => m.change.status === 'unchanged')).toBe(true);
    expect(td(d, 'a.web.dto.Req.Line').change.oldId).toBe('a.web.Req.Line');
    expect(d.some((x) => x.change.status === 'added' || x.change.status === 'removed')).toBe(false);
  });
});

describe('detectCrossFileMoves', () => {
  const SVC_OLD = `package app;
public class PlaceOrderService {
    public void place(Cmd c) {
        validate(c);
        repo.save(c);
    }

    private void validate(Cmd c) {
        if (c.lines().isEmpty()) {
            throw new IllegalArgumentException("Sipariş satırı yok");
        }
        if (c.currency() == null || c.currency().isBlank()) {
            throw new IllegalArgumentException("Para birimi yok");
        }
    }
}
`;
  const SVC_NEW = `package app;
public class PlaceOrderService {
    private final OrderValidator validator = new OrderValidator();
    public void place(Cmd c) {
        validator.validate(c);
        repo.save(c);
    }
}
`;
  const VALIDATOR = `package domain;
public class OrderValidator {
    public void validate(Cmd c) {
        if (c.lines().isEmpty()) {
            throw new IllegalArgumentException("Sipariş satırı yok");
        }
        if (c.currency() == null || c.currency().isBlank()) {
            throw new IllegalArgumentException("Para birimi yok");
        }
    }
}
`;

  it('başka dosyaya taşınan metot tek moved kayıt olur; eski removed iki listeden de çıkar', async () => {
    const diffs = [
      ...(await diff(SVC_OLD, SVC_NEW, 'app/PlaceOrderService.java')),
      ...(await diff(undefined, VALIDATOR, 'domain/OrderValidator.java')),
    ];
    detectCrossFileMoves(diffs);
    const svc = td(diffs, 'app.PlaceOrderService');
    expect(svc.members.some((m) => m.change.id === 'app.PlaceOrderService#validate(Cmd)')).toBe(false);
    expect(svc.change.members.some((m) => m.id === 'app.PlaceOrderService#validate(Cmd)')).toBe(false);
    expect(svc.change.members.length).toBe(svc.members.length);
    svc.members.forEach((m, i) => expect(svc.change.members[i]).toBe(m.change));
    const v = td(diffs, 'domain.OrderValidator');
    const moved = md(v, 'domain.OrderValidator#validate(Cmd)');
    expect(moved.change.status).toBe('moved');
    expect(moved.change.oldId).toBe('app.PlaceOrderService#validate(Cmd)');
    expect(moved.change.oldName).toBe('validate');
    expect(moved.change.oldSignature).toBe('private void validate(Cmd c)');
    expect(moved.change.oldRange).toEqual({ startLine: 8, endLine: 15 });
    expect(moved.change.flags).toContain('visibility');
    expect(moved.change.details).toEqual(['taşındı: PlaceOrderService → OrderValidator', 'görünürlük: private → public']);
    expect(moved.oldMember?.ownerFqn).toBe('app.PlaceOrderService');
    expect(v.change.members).toContain(moved.change);
    expect(v.members.some((m) => m.change.status === 'added' && m.change.name === 'validate')).toBe(false);
  });

  it('benzer olmayan metotlar taşınmış sayılmaz', async () => {
    const other = 'package domain;\npublic class X {\n  public void validate(Cmd c) {\n    log.info("tamamen farklı bir gövde");\n    c.run();\n  }\n}\n';
    const diffs = [
      ...(await diff(SVC_OLD, SVC_NEW, 'app/PlaceOrderService.java')),
      ...(await diff(undefined, other, 'domain/X.java')),
    ];
    detectCrossFileMoves(diffs);
    expect(md(td(diffs, 'app.PlaceOrderService'), 'app.PlaceOrderService#validate(Cmd)').change.status).toBe('removed');
    expect(md(td(diffs, 'domain.X'), 'domain.X#validate(Cmd)').change.status).toBe('added');
  });
});

describe('memberSimilarity', () => {
  it('aynı gövde 1, farklı gövde düşük, gövdesizlerde imza benzerliği', async () => {
    const m = await parseJavaFile(
      'S.java',
      `interface S {
  int a(int x);
  int b(int y);
  String c(long z, String w);
}
class T {
  int f(int x) { int s = 0; for (int i = 0; i < x; i++) { s += i; } return s; }
  int g(int x) { int s = 0; for (int i = 0; i < x; i++) { s += i; } return s; }
  int h(int x) { return helper(x).value(); }
}
`,
    );
    const s = m.types[0]?.members ?? [];
    const t = m.types[1]?.members ?? [];
    const [a, b, c] = s as [NonNullable<(typeof s)[0]>, NonNullable<(typeof s)[0]>, NonNullable<(typeof s)[0]>];
    const [f, g, h] = t as [NonNullable<(typeof t)[0]>, NonNullable<(typeof t)[0]>, NonNullable<(typeof t)[0]>];
    expect(memberSimilarity(f, g)).toBe(1);
    expect(memberSimilarity(f, h)).toBeLessThan(0.5);
    expect(memberSimilarity(a, b)).toBe(1);
    expect(memberSimilarity(a, c)).toBeLessThan(0.5);
    expect(memberSimilarity(a, f)).toBe(0);
  });
});

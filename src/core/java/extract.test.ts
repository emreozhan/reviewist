import { describe, expect, it } from 'vitest';
import { parseJavaFile } from './extract.js';
import type { JavaFileModel, JavaMember, JavaType } from './model.js';

function type(m: JavaFileModel, fqn: string): JavaType {
  const t = m.types.find((x) => x.fqn === fqn);
  if (!t) throw new Error(`tip yok: ${fqn} (var: ${m.types.map((x) => x.fqn).join(', ')})`);
  return t;
}

function member(t: JavaType, id: string): JavaMember {
  const m = t.members.find((x) => x.id === id);
  if (!m) throw new Error(`üye yok: ${id} (var: ${t.members.map((x) => x.id).join(', ')})`);
  return m;
}

const ORDER_SERVICE = `package com.acme.order;

import com.acme.order.model.Order;
import java.util.*;
import static java.util.Objects.requireNonNull;
import static com.acme.util.Strings.*;

/**
 * Sipariş servisi.
 */
@Service
public class OrderService extends AbstractService<Order> implements OrderUseCase, Auditable {
    private static final int MAX = 10, MIN = 1;
    private final OrderRepository repo;
    private String url = "http://example.com // not a comment";

    public OrderService(OrderRepository repo) {
        super(repo);
        this.repo = repo;
    }

    /** Siparişi yerleştirir. */
    @Override
    @Transactional(readOnly = false)
    public <T extends Order> Optional<Order> place(final Map<String, List<T>> items, java.util.List<String>[] tags, int qty, String... notes) throws IOException, OrderException {
        // TODO: doğrulama ekle
        requireNonNull(items);
        if (qty > MAX || qty < MIN) {
            throw new IllegalArgumentException("qty");
        }
        var order = new Order(qty);
        for (String n : notes) {
            order.addNote(n);
        }
        Runnable r = new Runnable() {
            @Override
            public void run() {
                audit(order);
            }
        };
        items.forEach((k, v) -> repo.save(order));
        try {
            repo.flush();
        } catch (IllegalStateException e) {
            // yut
        }
        String sql = "SELECT * FROM orders WHERE id = ?";
        int x = qty > 5 ? 1 : 2;
        this.repo.count();
        super.close();
        notes.stream().map(String::trim).forEach(System.out::println);
        if (order instanceof Order o && o != null) {
            System.out.println(o);
        }
        return Optional.ofNullable(order);
    }

    static {
        System.out.println("init");
    }

    {
        counter++;
    }

    public static class Inner {
        void ping() { pong(); }
        void pong() {}

        interface Deep {
            int K = 1;
            void deep();
            default void def() { deep(); }
        }
    }
}
`;

describe('parseJavaFile', () => {
  it('paket, importlar (static/wildcard) ve tip başlığını çıkarır', async () => {
    const m = await parseJavaFile('OrderService.java', ORDER_SERVICE);
    expect(m.packageName).toBe('com.acme.order');
    expect(m.hasErrors).toBe(false);
    expect(m.imports).toEqual([
      { name: 'com.acme.order.model.Order', static: false, wildcard: false, line: 3 },
      { name: 'java.util', static: false, wildcard: true, line: 4 },
      { name: 'java.util.Objects.requireNonNull', static: true, wildcard: false, line: 5 },
      { name: 'com.acme.util.Strings', static: true, wildcard: true, line: 6 },
    ]);
    const t = type(m, 'com.acme.order.OrderService');
    expect(t.kind).toBe('class');
    expect(t.visibility).toBe('public');
    expect(t.annotations).toEqual(['@Service']);
    expect(t.superclass).toBe('AbstractService');
    expect(t.interfaces).toEqual(['OrderUseCase', 'Auditable']);
    expect(t.javadoc).toContain('Sipariş servisi');
    expect(t.nestedTypeFqns).toEqual(['com.acme.order.OrderService.Inner']);
    expect(t.fieldTypes).toMatchObject({ MAX: 'int', MIN: 'int', repo: 'OrderRepository', url: 'String' });
    expect(m.lineCount).toBe(ORDER_SERVICE.split('\n').length - 1);
    expect(m.normalizedCode).not.toContain('import');
  });

  it('iç tipleri Outer.Inner FQN ile ve arayüz üyelerini örtük değiştiricilerle çıkarır', async () => {
    const m = await parseJavaFile('OrderService.java', ORDER_SERVICE);
    const inner = type(m, 'com.acme.order.OrderService.Inner');
    expect(inner.outerFqn).toBe('com.acme.order.OrderService');
    expect(inner.modifiers).toEqual(['public', 'static']);
    const deep = type(m, 'com.acme.order.OrderService.Inner.Deep');
    expect(deep.kind).toBe('interface');
    const k = member(deep, 'com.acme.order.OrderService.Inner.Deep#K');
    expect(k.modifiers).toEqual(expect.arrayContaining(['public', 'static', 'final']));
    expect(k.visibility).toBe('public');
    const abs = member(deep, 'com.acme.order.OrderService.Inner.Deep#deep()');
    expect(abs.modifiers).toEqual(expect.arrayContaining(['public', 'abstract']));
    expect(abs.visibility).toBe('public');
    expect(abs.normalizedBody).toBe('');
    const def = member(deep, 'com.acme.order.OrderService.Inner.Deep#def()');
    expect(def.modifiers).toContain('default');
    expect(def.modifiers).not.toContain('abstract');
    expect(def.callSites.map((c) => c.name)).toEqual(['deep']);
  });

  it('metot id/imza: generic silme, paket öneki, dizi ve varargs korunur', async () => {
    const m = await parseJavaFile('OrderService.java', ORDER_SERVICE);
    const t = type(m, 'com.acme.order.OrderService');
    const place = member(t, 'com.acme.order.OrderService#place(Map,List[],int,String...)');
    expect(place.kind).toBe('method');
    expect(place.returnType).toBe('Optional<Order>');
    expect(place.typeParams).toBe('<T extends Order>');
    expect(place.throws).toEqual(['IOException', 'OrderException']);
    expect(place.params).toEqual([
      { name: 'items', type: 'Map<String, List<T>>', varargs: false },
      { name: 'tags', type: 'java.util.List<String>[]', varargs: false },
      { name: 'qty', type: 'int', varargs: false },
      { name: 'notes', type: 'String...', varargs: true },
    ]);
    expect(place.annotations).toEqual(['@Override', '@Transactional(readOnly = false)']);
    expect(place.signature).toBe(
      'public <T extends Order> Optional<Order> place(Map<String, List<T>> items, java.util.List<String>[] tags, int qty, String... notes) throws IOException, OrderException',
    );
    expect(place.visibility).toBe('public');
    expect(place.javadoc).toBe('/** Siparişi yerleştirir. */');
    expect(place.javadocRange).toEqual({ startLine: 22, endLine: 22 });
    // range javadoc hariç, annotation'lar dahil
    expect(place.range.startLine).toBe(23);
    expect(place.text.trimStart().startsWith('@Override')).toBe(true);
  });

  it('yapıcı, çoklu alan, statik/instance initializer', async () => {
    const m = await parseJavaFile('OrderService.java', ORDER_SERVICE);
    const t = type(m, 'com.acme.order.OrderService');
    const ctor = member(t, 'com.acme.order.OrderService#OrderService(OrderRepository)');
    expect(ctor.kind).toBe('constructor');
    expect(ctor.callSites[0]).toMatchObject({ name: 'AbstractService', isConstructor: true, receiverKind: 'super', argCount: 1 });
    const max = member(t, 'com.acme.order.OrderService#MAX');
    const min = member(t, 'com.acme.order.OrderService#MIN');
    expect(max.fieldType).toBe('int');
    expect(max.initializerText).toBe('10');
    expect(min.initializerText).toBe('1');
    expect(max.normalizedText).toBe('private static final int MAX = 10 ;');
    expect(min.normalizedText).toBe('private static final int MIN = 1 ;');
    expect(max.signature).toBe('private static final int MAX');
    expect(member(t, 'com.acme.order.OrderService#<clinit>#0').kind).toBe('initializer');
    expect(member(t, 'com.acme.order.OrderService#<init>#0').normalizedBody).toBe('{counter++;}');
  });

  it('normalizasyon: yorumlar atılır, string içeriği (// dahil) korunur', async () => {
    const m = await parseJavaFile('OrderService.java', ORDER_SERVICE);
    const t = type(m, 'com.acme.order.OrderService');
    const url = member(t, 'com.acme.order.OrderService#url');
    expect(url.normalizedBody).toBe('"http://example.com // not a comment"');
    const place = member(t, 'com.acme.order.OrderService#place(Map,List[],int,String...)');
    expect(place.normalizedBody).not.toContain('TODO');
    expect(place.normalizedBody).not.toMatch(/\s(?=(?:[^"]*"[^"]*")*[^"]*$)/); // string dışında boşluk yok
    expect(place.normalizedBody).toContain('"SELECT * FROM orders WHERE id = ?"');
    expect(place.normalizedText).toContain('requireNonNull ( items ) ;');
    expect(place.normalizedText).not.toContain('yut');
  });

  it('çağrı yerleri: anonim sınıf, lambda, method ref, receiverKind', async () => {
    const m = await parseJavaFile('OrderService.java', ORDER_SERVICE);
    const t = type(m, 'com.acme.order.OrderService');
    const place = member(t, 'com.acme.order.OrderService#place(Map,List[],int,String...)');
    const byName = (n: string) => place.callSites.filter((c) => c.name === n);
    expect(byName('requireNonNull')[0]).toMatchObject({ receiverKind: 'none', argCount: 1 });
    expect(byName('IllegalArgumentException')[0]).toMatchObject({ isConstructor: true, argCount: 1 });
    expect(byName('Order')[0]).toMatchObject({ isConstructor: true, argCount: 1, receiverKind: 'none' });
    expect(byName('addNote')[0]).toMatchObject({ receiverKind: 'identifier', receiver: 'order' });
    // anonim sınıf içindeki çağrı kapsayan metoda atanır; anonim sınıf ayrı tip değildir
    expect(byName('audit')[0]).toMatchObject({ receiverKind: 'none', argCount: 1 });
    expect(byName('Runnable')[0]).toMatchObject({ isConstructor: true });
    expect(m.types.some((x) => x.name === 'Runnable')).toBe(false);
    // lambda içi
    expect(byName('save')[0]).toMatchObject({ receiverKind: 'identifier', receiver: 'repo' });
    expect(byName('flush')[0]?.line).toBe(43);
    expect(byName('count')[0]).toMatchObject({ receiverKind: 'field-access', receiver: 'this.repo' });
    expect(byName('close')[0]).toMatchObject({ receiverKind: 'super' });
    expect(byName('trim')[0]).toMatchObject({ isMethodRef: true, argCount: -1, receiverKind: 'identifier', receiver: 'String' });
    expect(byName('println').find((c) => c.isMethodRef)).toMatchObject({ receiverKind: 'field-access', receiver: 'System.out' });
    expect(byName('map')[0]).toMatchObject({ receiverKind: 'expression' });
    expect(byName('ofNullable')[0]).toMatchObject({ receiverKind: 'identifier', receiver: 'Optional' });
  });

  it('localTypes, karmaşıklık ve özellik sayımları', async () => {
    const m = await parseJavaFile('OrderService.java', ORDER_SERVICE);
    const t = type(m, 'com.acme.order.OrderService');
    const place = member(t, 'com.acme.order.OrderService#place(Map,List[],int,String...)');
    expect(place.localTypes).toMatchObject({
      items: 'Map<String, List<T>>',
      qty: 'int',
      notes: 'String...',
      order: 'Order',
      n: 'String',
      r: 'Runnable',
      e: 'IllegalStateException',
      sql: 'String',
      o: 'Order',
    });
    // 1 + if + || + for + catch + ternary + if + && = 8
    expect(place.complexity).toBe(8);
    expect(place.features).toEqual({
      catches: 1,
      emptyCatches: 1,
      throwsNew: 1,
      synchronizedBlocks: 0,
      sqlStrings: 1,
      printStackTrace: 0,
      systemOut: 2,
      todos: 1,
      nullChecks: 3, // requireNonNull, != null, Optional.ofNullable
      returnsNull: 0,
    });
  });

  it('record, compact yapıcı, enum ve annotation tipi', async () => {
    const src = `package p;
public record Money(java.math.BigDecimal amount, String currency) implements Comparable<Money> {
  public Money {
    if (amount == null) throw new IllegalArgumentException();
  }
  public Money(String c) { this(java.math.BigDecimal.ZERO, c); }
}
enum Status implements Labeled {
  NEW("n") {
    @Override String label() { return helper(); }
  },
  DONE("d");
  private final String code;
  Status(String code) { this.code = code; }
  String label() { return code; }
}
@interface Audit {
  String value() default "x";
  int level();
}
`;
    const m = await parseJavaFile('Money.java', src);
    const money = type(m, 'p.Money');
    expect(money.kind).toBe('record');
    expect(money.interfaces).toEqual(['Comparable']);
    expect(money.fieldTypes).toEqual({ amount: 'java.math.BigDecimal', currency: 'String' });
    const amount = member(money, 'p.Money#amount');
    expect(amount).toMatchObject({ kind: 'field', visibility: 'private' });
    expect(amount.modifiers).toEqual(expect.arrayContaining(['private', 'final']));
    const compact = member(money, 'p.Money#Money(BigDecimal,String)');
    expect(compact.kind).toBe('constructor');
    expect(compact.features.nullChecks).toBe(1);
    const other = member(money, 'p.Money#Money(String)');
    expect(other.callSites[0]).toMatchObject({ name: 'Money', receiverKind: 'this', isConstructor: true, argCount: 2 });

    const status = type(m, 'p.Status');
    expect(status.kind).toBe('enum');
    expect(status.interfaces).toEqual(['Labeled']);
    const nw = member(status, 'p.Status#NEW');
    expect(nw.kind).toBe('enumConstant');
    expect(nw.callSites.map((c) => c.name)).toEqual(['helper']);
    expect(nw.normalizedBody).toBe('("n"){@OverrideStringlabel(){returnhelper();}}');
    expect(member(status, 'p.Status#Status(String)').visibility).toBe('private');
    expect(status.fieldTypes).toMatchObject({ NEW: 'Status', DONE: 'Status', code: 'String' });

    const audit = type(m, 'p.Audit');
    expect(audit.kind).toBe('annotation');
    const value = member(audit, 'p.Audit#value()');
    expect(value).toMatchObject({ kind: 'method', returnType: 'String', visibility: 'public', normalizedBody: '"x"' });
    expect(member(audit, 'p.Audit#level()').modifiers).toEqual(expect.arrayContaining(['public', 'abstract']));
  });

  it('varsayılan paket, text block SQL, switch case karmaşıklığı, synchronized ve null dönüşü', async () => {
    const src = `class Repo {
  Object find(int k) {
    String q = """
        select id
        from t where k = ?
        """;
    synchronized (this) {
      switch (k) {
        case 1: return null;
        case 2, 3: break;
        default: break;
      }
    }
    try { run(); } catch (Exception e) { e.printStackTrace(); }
    return k > 0 ? q : null;
  }
}
`;
    const m = await parseJavaFile('Repo.java', src);
    expect(m.packageName).toBe('');
    const t = type(m, 'Repo');
    const f = member(t, 'Repo#find(int)');
    expect(f.features.sqlStrings).toBe(1);
    expect(f.features.synchronizedBlocks).toBe(1);
    expect(f.features.returnsNull).toBe(1);
    expect(f.features.printStackTrace).toBe(1);
    expect(f.features.emptyCatches).toBe(0);
    // 1 + case + case + catch + ternary
    expect(f.complexity).toBe(5);
  });

  it('hatalı kaynakta çökmez, hasErrors/errorLines doldurur ve elinden geleni çıkarır', async () => {
    const src = `package p;
public class Broken {
  void ok() { a(); }
  void bad( { int x = ; }
  int after() { return 1; }
}
`;
    const m = await parseJavaFile('Broken.java', src);
    expect(m.hasErrors).toBe(true);
    expect(m.errorLines.length).toBeGreaterThan(0);
    expect(m.errorLines).toContain(4);
    const t = type(m, 'p.Broken');
    expect(t.members.some((x) => x.name === 'ok')).toBe(true);
  });

  it('tamamen bozuk / boş kaynakta çökmez', async () => {
    const empty = await parseJavaFile('Empty.java', '');
    expect(empty.types).toEqual([]);
    expect(empty.lineCount).toBe(0);
    const garbage = await parseJavaFile('G.java', '}}} class { void ( ;; "unterminated');
    expect(garbage.hasErrors).toBe(true);
  });

  it('localTypes: tipli lambda, multi-catch, record pattern, try-with-resources var, var dizi/cast', async () => {
    const src = `class L {
  void f(Object obj) {
    java.util.function.BiFunction<String, Integer, String> fn = (String s, int n) -> s.repeat(n);
    try (var in = new java.io.FileInputStream("x"); Reader rd = open()) {
      var arr = new int[3];
      var cast = (Order) obj;
    } catch (IOException | RuntimeException ex) {
      ex.getMessage();
    }
    if (obj instanceof Point(int px, Line ln)) { ln.draw(); }
  }
}
`;
    const m = await parseJavaFile('L.java', src);
    const f = member(type(m, 'L'), 'L#f(Object)');
    expect(f.localTypes).toMatchObject({
      obj: 'Object',
      s: 'String',
      n: 'int',
      in: 'java.io.FileInputStream',
      rd: 'Reader',
      arr: 'int[]',
      cast: 'Order',
      ex: 'IOException',
      px: 'int',
      ln: 'Line',
    });
    expect(f.localTypes.fn).toBe('java.util.function.BiFunction<String, Integer, String>');
  });

  it('javadoc yalnız hemen önceki /** */ yorumundan alınır; düz yorum javadoc değildir', async () => {
    const src = `class A {
  /* düz yorum */
  void a() {}
  /** doc b */
  // araya giren satır yorumu
  void b() {}
  /** doc c */
  @Deprecated
  void c() {}
}
`;
    const m = await parseJavaFile('A.java', src);
    const t = type(m, 'A');
    expect(member(t, 'A#a()').javadoc).toBeUndefined();
    expect(member(t, 'A#b()').javadoc).toBeUndefined();
    const c = member(t, 'A#c()');
    expect(c.javadoc).toBe('/** doc c */');
    expect(c.range).toEqual({ startLine: 8, endLine: 9 });
    expect(c.javadocRange).toEqual({ startLine: 7, endLine: 7 });
  });
});

/**
 * Kod gezinme için konumlar (çağrı adı sütunları, bildirim adları, tip referansları).
 * Sütunlar satır içi 0 tabanlı UTF-16 kod birimi, [start, end).
 */
import { describe, expect, it } from 'vitest';
import { parseJavaFile } from './extract.js';
import type { CallSite, JavaFileModel, JavaMember, JavaType } from './model.js';
import { parseJavaFiles } from './parsePool.js';
import { decodeTypeRefPositions, type TypeRefPosition } from './typeRefTable.js';

function lineText(src: string, line: number): string {
  return src.split('\n')[line - 1] ?? '';
}

/** Konumdaki metin (UTF-16 dilim). */
function at(src: string, line: number, col: number, endCol: number): string {
  return lineText(src, line).slice(col, endCol);
}

function allSites(m: JavaFileModel): { member: JavaMember; site: CallSite }[] {
  return m.types.flatMap((t) => t.members.flatMap((member) => member.callSites.map((site) => ({ member, site }))));
}

function siteText(src: string, s: CallSite): string {
  if (s.col === undefined || s.endCol === undefined) throw new Error(`sütun yok: ${s.name}`);
  return at(src, s.nameLine ?? s.line, s.col, s.endCol);
}

function refs(m: JavaFileModel): TypeRefPosition[] {
  return decodeTypeRefPositions(m.typeRefPositions);
}

function declText(src: string, d: JavaMember | JavaType): string {
  if (d.nameLine === undefined || d.nameCol === undefined || d.nameEndCol === undefined) throw new Error('ad konumu yok');
  return at(src, d.nameLine, d.nameCol, d.nameEndCol);
}

const SRC = `package com.acme;

import com.acme.util.Helper;
import java.util.List;

public class Shop<T extends Base> extends AbstractShop implements Store, Comparable<Shop<T>> {
    private final List<Order> orders = new ArrayList<>();
    private Map.Entry<String, Outer.Inner> entry;
    static final int MAX = 3;

    public Shop(Repo repo) {
        super(repo);
    }

    Shop() { this(null); }

    public Order place(Order order, int qty) throws ShopException {
        Order copy = (Order) order.clone();
        Helper.check(copy, Order.class);
        Runnable r = Helper::run;
        java.util.function.Supplier<Order> s = Order::new;
        Outer.Inner.go();
        int x = Constants.MAX + MAX;
        return new com.acme.model.Order(copy);
    }

    static class Nested { }

    @Service
    enum Kind { A, B }
}
`;

describe('extract: çağrı adı sütunları', () => {
  it('metot çağrısı, yapıcı (nitelikli/generic), method ref, this()/super()', async () => {
    const m = await parseJavaFile('Shop.java', SRC);
    const sites = allSites(m);
    for (const { site } of sites) {
      const text = siteText(SRC, site);
      if (site.isMethodRef && site.isConstructor) expect(text).toBe('new');
      else if (site.receiverKind === 'super' && site.receiver === 'super' && site.isConstructor) expect(text).toBe('super');
      else if (site.receiverKind === 'this' && site.receiver === 'this' && site.isConstructor) expect(text).toBe('this');
      else expect(text).toBe(site.name.slice(site.name.lastIndexOf('.') + 1));
    }
    const byName = (n: string) => sites.find((x) => x.site.name === n)?.site;
    expect(byName('check')).toMatchObject({ line: 19, col: 15, endCol: 20 });
    expect(byName('run')).toMatchObject({ isMethodRef: true, col: 29, endCol: 32 });
    expect(byName('ArrayList')).toMatchObject({ isConstructor: true, col: 43, endCol: 52 });
    // nitelikli yapıcı: basit ad sütunu
    const q = sites.find((x) => x.site.isConstructor && x.site.name.includes('model'))?.site;
    expect(q && siteText(SRC, q)).toBe('Order');
  });

  it('yapıcı tip adı ayrı satırda: nameLine', async () => {
    const src = 'class A {\n  Object o = new\n      Foo(1);\n}\n';
    const m = await parseJavaFile('A.java', src);
    const s = allSites(m)[0]?.site;
    expect(s).toMatchObject({ name: 'Foo', line: 2, nameLine: 3, col: 6, endCol: 9 });
  });
});

describe('extract: bildirim ad konumları', () => {
  it('tip, iç tip, enum, yapıcı, metot, alan, enum sabiti, initializer', async () => {
    const src = `class Outer {
\tint a, b = 2;
\tstatic { }
\t{ }
\tOuter() { }
\tvoid run() { }
\tenum E { X, Y }
\trecord R(int p, String... rest) { R { } }
}
`;
    const m = await parseJavaFile('Outer.java', src);
    for (const t of m.types) {
      expect(declText(src, t)).toBe(t.name);
      for (const mem of t.members) {
        if (mem.kind === 'initializer') expect(declText(src, mem)).toBe(mem.name === '<clinit>' ? 'static' : '{');
        else expect(declText(src, mem)).toBe(mem.name);
      }
    }
    const outer = m.types.find((t) => t.name === 'Outer');
    // sekme tek UTF-16 kod birimi
    expect(outer?.members.find((x) => x.name === 'b')).toMatchObject({ nameLine: 2, nameCol: 8, nameEndCol: 9 });
  });
});

describe('extract: tip referansı konumları', () => {
  it('alan/parametre/dönüş/yerel/extends/implements/new/cast/.class/generic/throws/statik alıcı/method ref alıcısı', async () => {
    const m = await parseJavaFile('Shop.java', SRC);
    const rs = refs(m);
    for (const r of rs) expect(at(SRC, r.line, r.col, r.endCol)).toBe(r.name.slice(r.name.lastIndexOf('.') + 1));
    const names = (line: number) => rs.filter((r) => r.line === line).map((r) => r.name);
    expect(names(6)).toEqual(['T', 'Base', 'AbstractShop', 'Store', 'Comparable', 'Shop', 'T']);
    expect(names(7)).toEqual(['List', 'Order', 'ArrayList']);
    expect(names(8)).toEqual(['Map', 'Map.Entry', 'String', 'Outer', 'Outer.Inner']);
    expect(names(11)).toEqual(['Repo']);
    expect(names(17)).toEqual(['Order', 'Order', 'ShopException']);
    expect(names(18)).toEqual(['Order', 'Order']); // yerel tip + cast
    expect(names(19)).toEqual(['Helper', 'Order']); // statik alıcı + X.class
    expect(names(20)).toEqual(['Runnable', 'Helper']);
    // java.util.function.Supplier: paket parçaları atlanır; Order::new alıcısı
    expect(names(21)).toEqual(['java.util.function.Supplier', 'Order', 'Order']);
    expect(names(22)).toEqual(['Outer', 'Outer.Inner']);
    expect(names(23)).toEqual(['Constants']); // MAX sabitleri değil
    expect(names(24)).toEqual(['com.acme.model.Order']);
    expect(names(29)).toEqual(['Service']);
    const expr = rs.filter((r) => r.expr).map((r) => `${r.line}:${r.name}`);
    expect(expr).toEqual(['19:Helper', '20:Helper', '21:Order', '22:Outer', '22:Outer.Inner', '23:Constants']);
    expect(rs.filter((r) => r.annotation).map((r) => r.name)).toEqual(['Service']);
  });

  it('maskelenmiş varargs anotasyonu sütunları kaydırmaz; anotasyon adı da referans', async () => {
    const src = `class V {
    void f(Object @Nullable ... args) { g(args); }
    void g(Object[] a) { }
}
`;
    const m = await parseJavaFile('V.java', src);
    expect(m.hasErrors).toBe(false);
    const f = m.types[0]?.members.find((x) => x.name === 'f');
    expect(f && declText(src, f)).toBe('f');
    const g = allSites(m).find((x) => x.site.name === 'g')?.site;
    expect(g).toMatchObject({ line: 2, col: 40, endCol: 41 });
    const rs = refs(m).filter((r) => r.line === 2);
    expect(rs.map((r) => [r.name, at(src, r.line, r.col, r.endCol), r.annotation])).toEqual([
      ['Object', 'Object', false],
      ['Nullable', 'Nullable', true],
    ]);
  });

  it('Unicode/Türkçe tanımlayıcılar ve sekmeler: sütunlar UTF-16 kod birimi', async () => {
    const src = `package tr;

class Sipariş {
\tÖdeme ödeme = new Ödeme();
\t/* 😀 */ Ürün ürün = Ürün.yeni("ğ😀");
\tvoid öde() { ödeme.çek(ürün, "😀😀"); Ödeme.sıfırla(); }
}
`;
    const m = await parseJavaFile('Sipariş.java', src);
    const t = m.types[0];
    expect(t && declText(src, t)).toBe('Sipariş');
    for (const mem of t?.members ?? []) expect(declText(src, mem)).toBe(mem.name);
    for (const { site } of allSites(m)) expect(siteText(src, site)).toBe(site.name);
    const cek = allSites(m).find((x) => x.site.name === 'çek')?.site;
    expect(cek).toMatchObject({ line: 6, col: 20, endCol: 23 });
    // emoji (2 kod birimi) sonrası sütun
    const yeni = allSites(m).find((x) => x.site.name === 'yeni')?.site;
    expect(yeni).toMatchObject({ line: 5, col: 27, endCol: 31 });
    const rs = refs(m);
    for (const r of rs) expect(at(src, r.line, r.col, r.endCol)).toBe(r.name);
    expect(rs.map((r) => `${r.line}:${r.col}:${r.name}`)).toEqual([
      '4:1:Ödeme',
      '4:19:Ödeme',
      '5:10:Ürün',
      '5:22:Ürün',
      '6:39:Ödeme',
    ]);
  });

  it('işçi havuzu (structured clone) ve önbellek: konumlar korunur, tekrar ayrıştırmada aynı nesne', async () => {
    const files = Array.from({ length: 45 }, (_, i) => ({
      path: `p/C${i}.java`,
      source: `package p;\nclass C${i} extends Base { Foo f = Foo.make(); }\n`,
      cacheKey: `k${i}`,
    }));
    const models = await parseJavaFiles(files, { concurrency: 2 });
    const r = refs(models[44] as JavaFileModel);
    expect(r.map((x) => `${x.line}:${x.col}:${x.name}`)).toEqual(['2:18:Base', '2:25:Foo', '2:33:Foo']);
    const again = await parseJavaFiles(files.slice(44), { concurrency: 1 });
    expect(again[0]).toBe(models[44]);
  });
});

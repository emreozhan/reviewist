/**
 * Tur 3 (QA turu 1 bulguları): B1(d), B3, B4, B6, B7, B8, B9, B10, B13, anonim sınıflar, targetsOfCallSite/typesByFqn.
 */
import { describe, expect, it } from 'vitest';
import { parseJavaFile } from './extract.js';
import type { JavaFileModel, JavaMember, TypeDiff } from './model.js';
import { isTestPath, sourceRootOf } from './names.js';
import { RepoIndex } from './repoIndex.js';
import { detectCrossFileMoves, diffJavaFile } from './semanticDiff.js';

async function build(files: Record<string, string>): Promise<{ idx: RepoIndex; models: JavaFileModel[] }> {
  const models = await Promise.all(Object.entries(files).map(([p, s]) => parseJavaFile(p, s)));
  return { idx: RepoIndex.build(models), models };
}

function member(m: JavaFileModel, id: string): JavaMember {
  for (const t of m.types) for (const x of t.members) if (x.id === id) return x;
  throw new Error(`üye yok: ${id}`);
}

const callersOf = (idx: RepoIndex, id: string): string[] =>
  idx.callersOf(id).map((c) => `${c.fromId}@${c.line}:${c.confidence}`);

describe('B4: varargs tip anotasyonu maskeleme', () => {
  it('Object @Nullable ... args hatasız ayrışır; parametre ve sonraki metotlar kaybolmaz', async () => {
    const src = [
      'package x;',
      'public class A1 {',
      '  void varargsAnn(@Deprecated Object @Deprecated ... args) {}',
      '  public static void checkArgument(boolean b, String t, @Nullable Object @Nullable @A(x = "a)", y = {1, 2}) /* c */ @B ... args) {',
      '    if (!b) throw new IllegalArgumentException(t);',
      '  }',
      '  void next() {}',
      '}',
    ].join('\n');
    const m = await parseJavaFile('x/A1.java', src);
    expect(m.hasErrors).toBe(false);
    const ids = m.types[0]?.members.map((x) => x.id);
    expect(ids).toEqual(['x.A1#varargsAnn(Object...)', 'x.A1#checkArgument(boolean,String,Object...)', 'x.A1#next()']);
    const ca = member(m, 'x.A1#checkArgument(boolean,String,Object...)');
    expect(ca.range).toEqual({ startLine: 4, endLine: 6 });
    expect(ca.params.at(-1)).toEqual({ name: 'args', type: 'Object...', varargs: true });
    // ham metin ve normalize metin anotasyonu korur (maskeleme görünmez)
    expect(ca.text).toContain('@A(x = "a)", y = {1, 2})');
    expect(ca.normalizedText).toContain('@ A ( x = "a)" , y = { 1 , 2 } )');
    expect(member(m, 'x.A1#next()').range).toEqual({ startLine: 7, endLine: 7 });
  });

  it('yorum/string içindeki benzer metin maskelenmez; iki taraf aynı biçimde maskelenir (kozmetik tespiti korunur)', async () => {
    const a = 'class A {\n  // Object @Nullable ... args\n  String s = "Object @X ... y";\n  void f(Object @Nullable ... args) { g(); }\n}\n';
    const b = 'class A {\n  // Object @Nullable ... args\n  String s = "Object @X ... y";\n  void f(Object  @Nullable   ...  args)   { g(); }\n}\n';
    const ma = await parseJavaFile('A.java', a);
    const mb = await parseJavaFile('A.java', b);
    expect(ma.hasErrors).toBe(false);
    expect(member(ma, 'A#s').initializerText).toBe('"Object @X ... y"');
    const d = diffJavaFile(ma, mb);
    const f = d[0]?.members.find((x) => x.change.name === 'f');
    expect(f?.change.status).toBe('cosmetic');
    // anotasyon kaldırılırsa normalize metin değişir (sessizce yutulmaz)
    const c = await parseJavaFile('A.java', a.replace('void f(Object @Nullable ... args)', 'void f(Object ... args)'));
    expect(diffJavaFile(ma, c)[0]?.members.find((x) => x.change.name === 'f')?.change.status).toBe('modified');
  });

  it('diğer tip-kullanım anotasyonları (Outer.@A Inner, String @A [], generic, cast) zaten hatasız', async () => {
    const src = `class A {
  Outer.@Nullable Inner f(java.util.@Nullable List<String> x) { return null; }
  String @Nullable [] g(int @A [] @B [] grid) { String @C [] y = (@NonNull String @D []) null; return y; }
  java.util.List<@Nullable String> h(java.util.Map<@A String, ? extends @B Object> m) throws @C Exception { return null; }
  void next() {}
}`;
    const m = await parseJavaFile('A.java', src);
    expect(m.hasErrors).toBe(false);
    expect(m.types[0]?.members.map((x) => x.id)).toEqual(['A#f(List)', 'A#g(int[][])', 'A#h(Map)', 'A#next()']);
  });
});

describe('B10: null denetimi sayımı', () => {
  it('Objects.hashCode/equals/toString/requireNonNullElse(Get)/isNull/nonNull ve Optional.ofNullable sayılır', async () => {
    const m = await parseJavaFile(
      'A.java',
      `import java.util.*;
import static java.util.Objects.requireNonNullElse;
class A {
  Object a, b;
  int f() {
    int h = Objects.hashCode(a) + java.util.Objects.hash(a, b);
    boolean e = Objects.equals(a, b) && Objects.isNull(a) || Objects.nonNull(b);
    String s = Objects.toString(a) + Objects.requireNonNullElse(a, b) + Objects.requireNonNullElseGet(a, () -> b);
    Object o = Optional.ofNullable(a).orElse(b);
    Object r = requireNonNullElse(a, b);
    list().stream().filter(Objects::nonNull).count();
    hashCode(); toString();
    return h;
  }
  List<Object> list() { return null; }
}`,
    );
    // hashCode, hash, equals, isNull, nonNull, toString, requireNonNullElse, requireNonNullElseGet, ofNullable,
    // requireNonNullElse (statik import), Objects::nonNull = 11; alıcısız hashCode()/toString() sayılmaz
    expect(member(m, 'A#f()').features.nullChecks).toBe(11);
  });
});

describe('B9: tip değişkeni adı normalizasyonu', () => {
  it('<T> T foo(T) ↔ <E> E foo(E): imza değişikliği değil, kozmetik "tip parametresi adı değişti"', async () => {
    const o = await parseJavaFile('A.java', 'class A {\n  <T> T foo(T x) { T y = x; return y; }\n  <T> T bar(T x) { return null; }\n}\n');
    const n = await parseJavaFile('A.java', 'class A {\n  <E> E foo(E x) { E y = x; return y; }\n  <E> E bar(E x, int k) { return null; }\n}\n');
    const d = diffJavaFile(o, n)[0] as TypeDiff;
    const foo = d.members.find((x) => x.change.name === 'foo');
    expect(foo?.change.status).toBe('cosmetic');
    expect(foo?.change.details).toContain('tip parametresi adı değişti');
    expect(foo?.change.oldId).toBe('A#foo(T)');
    expect(d.members.find((x) => x.change.name === 'bar')?.change.status).toBe('signatureChanged');
  });

  it('sınıf tip parametresi T→E: üyeler imza değişikliği sayılmaz; tip kozmetik', async () => {
    const o = await parseJavaFile(
      'p/F.java',
      'package p;\n@FunctionalInterface\npublic interface F<T extends Throwable> {\n  void run() throws T;\n  default F<T> self() { return this; }\n}\n',
    );
    const n = await parseJavaFile(
      'p/F.java',
      'package p;\n@FunctionalInterface\npublic interface F<E extends Throwable> {\n  void run() throws E;\n  default F<E> self() { return this; }\n}\n',
    );
    const d = diffJavaFile(o, n)[0] as TypeDiff;
    expect(d.change.status).toBe('cosmetic');
    expect(d.change.flags).not.toContain('typeParams');
    expect(d.change.details.some((x) => x.startsWith('tip parametresi adı değişti'))).toBe(true);
    for (const m of d.members) expect(m.change.status).toBe('cosmetic');
    // sıra değişimi (K,V → V,K) gerçek değişikliktir
    const o2 = await parseJavaFile('M.java', 'class M<K, V> {\n  K key() { return null; }\n}\n');
    const n2 = await parseJavaFile('M.java', 'class M<V, K> {\n  K key() { return null; }\n}\n');
    const d2 = diffJavaFile(o2, n2)[0] as TypeDiff;
    expect(d2.members[0]?.change.status).toBe('signatureChanged');
  });
});

describe('B6: önemsiz gövdeler ve test↔üretim taşımaları', () => {
  async function moves(oldFiles: Record<string, string>, newFiles: Record<string, string>): Promise<TypeDiff[]> {
    const diffs: TypeDiff[] = [];
    const paths = new Set([...Object.keys(oldFiles), ...Object.keys(newFiles)]);
    for (const p of paths) {
      const o = oldFiles[p] !== undefined ? await parseJavaFile(p, oldFiles[p] as string) : undefined;
      const n = newFiles[p] !== undefined ? await parseJavaFile(p, newFiles[p] as string) : undefined;
      diffs.push(...diffJavaFile(o, n, { oldPath: p, newPath: p }));
    }
    detectCrossFileMoves(diffs);
    return diffs;
  }
  const statuses = (diffs: TypeDiff[]): string[] =>
    diffs.flatMap((d) => d.members.filter((m) => m.change.status !== 'unchanged').map((m) => `${m.change.id}:${m.change.status}`)).sort();

  it('farklı ad + farklı imza + kısa gövde (return false) taşındı sayılmaz', async () => {
    const diffs = await moves(
      { 'src/main/java/a/It.java': 'package a;\nclass It {\n  boolean hasNext() { return false; }\n}\n', 'src/main/java/a/F.java': 'package a;\nclass F {\n}\n' },
      { 'src/main/java/a/It.java': 'package a;\nclass It {\n}\n', 'src/main/java/a/F.java': 'package a;\nclass F {\n  boolean isSparse(int k) { return false; }\n}\n' },
    );
    expect(statuses(diffs)).toEqual(['a.F#isSparse(int):added', 'a.It#hasNext():removed']);
  });

  it('aynı imza şekli ya da uzun gövde ile taşıma korunur; test kökü ↔ üretim kökü eşleşmez', async () => {
    const body = '{ int s = 0; for (int i = 0; i < n; i++) { s += i * 2; } return s; }';
    const diffs = await moves(
      {
        'src/main/java/a/A.java': `package a;\nclass A {\n  int sum(int n) ${body}\n  Object nil() { return null; }\n}\n`,
        'src/main/java/a/B.java': 'package a;\nclass B {\n}\n',
        'src/test/java/a/T.java': 'package a;\nclass T {\n}\n',
      },
      {
        'src/main/java/a/A.java': 'package a;\nclass A {\n}\n',
        'src/main/java/a/B.java': `package a;\nclass B {\n  int total(int n) ${body}\n}\n`,
        'src/test/java/a/T.java': 'package a;\nclass T {\n  Object nil() { return null; }\n}\n',
      },
    );
    expect(statuses(diffs)).toEqual(['a.A#nil():removed', 'a.B#total(int):moved', 'a.T#nil():added']);
    expect(isTestPath('src/test/java/a/T.java')).toBe(true);
    expect(isTestPath('core/src/main/java/a/FooTests.java')).toBe(true);
    expect(isTestPath('src/main/java/a/Contest.java')).toBe(false);
  });

  it('aynı tip içinde farklı adlı kısa gövde: imza şekli farklıysa yeniden adlandırma sayılmaz', async () => {
    const o = await parseJavaFile('A.java', 'class A {\n  Object a() { return null; }\n}\n');
    const n = await parseJavaFile('A.java', 'class A {\n  String b(int x) { return null; }\n}\n');
    const d = diffJavaFile(o, n)[0] as TypeDiff;
    expect(d.members.map((m) => m.change.status).sort()).toEqual(['added', 'removed']);
    const n2 = await parseJavaFile('A.java', 'class A {\n  Object c() { return null; }\n}\n');
    expect(diffJavaFile(o, n2)[0]?.members.map((m) => m.change.status)).toEqual(['renamed']);
  });
});

describe('B7: git yeniden adlandırması (fileRenamed)', () => {
  it('tek üst düzey tip eşik ne olursa olsun eşlenir; iç tipler göreli adla', async () => {
    const o = await parseJavaFile(
      'a/BitMapProducer.java',
      'package a;\npublic interface BitMapProducer {\n  boolean forEach(int x);\n  static BitMapProducer of() { return null; }\n  class Impl {}\n}\n',
    );
    const n = await parseJavaFile(
      'a/BitMapExtractor.java',
      'package a;\npublic interface BitMapExtractor {\n  boolean processBitMaps(long[] y);\n  default long[] asArray() { return new long[0]; }\n  class Impl {}\n}\n',
    );
    const without = diffJavaFile(o, n, { oldPath: o.path, newPath: n.path });
    expect(without.map((d) => d.change.status).sort()).toContain('removed');
    const withFlag = diffJavaFile(o, n, { oldPath: o.path, newPath: n.path, fileRenamed: true });
    expect(withFlag.map((d) => `${d.change.id}:${d.change.status}:${d.change.oldId ?? ''}`)).toEqual([
      'a.BitMapExtractor:renamed:a.BitMapProducer',
      'a.BitMapExtractor.Impl:renamed:a.BitMapProducer.Impl',
    ]);
    const moved = await parseJavaFile('b/X.java', 'package b;\npublic class X {\n  void q() {}\n}\n');
    const one = await parseJavaFile('a/Y.java', 'package a;\npublic class Y {\n  int z;\n}\n');
    expect(diffJavaFile(one, moved, { fileRenamed: true })[0]?.change.status).toBe('moved');
    // iki üst düzey tipte zorlama yok
    const two = await parseJavaFile('a/Y.java', 'package a;\npublic class Y {\n  int z;\n}\nclass W {}\n');
    expect(diffJavaFile(two, moved, { fileRenamed: true }).some((d) => d.change.status === 'moved')).toBe(false);
  });
});

describe('B8: argüman tipleriyle overload seçimi', () => {
  const FILES = {
    'src/main/java/lang/StringUtils.java': `package lang;
import java.util.Iterator;
public class StringUtils {
  public static String join(Object[] array, char sep) { return null; }
  public static String join(Object[] array, String sep) { return null; }
  public static String join(long[] array, char sep) { return null; }
  public static String join(Iterable<?> it, String sep) { return null; }
  public static String join(Iterator<?> it, char sep) { return null; }
  @SafeVarargs public static <T> String join(T... elements) { return null; }
  public static String pad(String s, int n) { return s; }
  public static String pad(String s, long n) { return s; }
  public static String pad(String s, Object n) { return s; }
}`,
    'src/main/java/lang/Use.java': `package lang;
import java.util.List;
public class Use {
  private List<String> names;
  void run(String[] arr, long[] nums, java.util.Iterator<String> iter, Object o) {
    StringUtils.join(arr, ",");
    StringUtils.join(arr, ',');
    StringUtils.join(nums, ',');
    StringUtils.join(names, ",");
    StringUtils.join(iter, ';');
    StringUtils.join("a", "b", "c");
    StringUtils.join(o, x());
    StringUtils.pad("a", 3);
    StringUtils.pad("a", 3L);
    StringUtils.pad("a", o);
  }
  String x() { return ""; }
}`,
  };
  it('çok overload’lu join/pad doğru bağlanır', async () => {
    const { idx } = await build(FILES);
    const U = 'lang.Use#run(String[],long[],Iterator,Object)';
    const c = (id: string): string[] => callersOf(idx, `lang.StringUtils#${id}`);
    expect(c('join(Object[],String)')).toEqual([`${U}@6:exact`]);
    expect(c('join(Object[],char)')).toEqual([`${U}@7:exact`]);
    expect(c('join(long[],char)')).toEqual([`${U}@8:exact`]);
    expect(c('join(Iterable,String)')).toEqual([`${U}@9:exact`]); // List -> Iterable (JDK üst tip tablosu)
    expect(c('join(Iterator,char)')).toEqual([`${U}@10:exact`]);
    expect(c('join(T...)')).toEqual(expect.arrayContaining([`${U}@11:exact`]));
    expect(c('join(T...)').some((x) => /@(6|7|8|9|10):/.test(x))).toBe(false);
    // join(o, x()): o Object -> dizi/Iterable/Iterator parametrelerine uymaz; yalnız T... kalır
    expect(c('pad(String,int)')).toEqual([`${U}@13:exact`]);
    expect(c('pad(String,long)')).toEqual([`${U}@14:exact`]);
    expect(c('pad(String,Object)')).toEqual([`${U}@15:exact`]);
    // targetsOfCallSite: bağlanan hedefler
    expect(idx.targetsOfCallSite(U, 6, 'join')).toEqual(['lang.StringUtils#join(Object[],String)']);
    expect(idx.targetsOfCallSite(U, 99, 'join')).toEqual([]);
  });
});

describe('B1(d): iç sınıf aynı metodu tanımlıyor / statik import', () => {
  const FILES = {
    'src/c/ImmutableMap.java': `package c;
public abstract class ImmutableMap<K, V> {
  abstract Object createKeySet();
  Object keySet() { return createKeySet(); }
  abstract static class IteratorBasedImmutableMap<K, V> extends ImmutableMap<K, V> {
    Object createEntrySet() { return null; }
    Object entrySet() { return createEntrySet(); }
    Object createKeySet() { return null; }
  }
}`,
    'src/c/Predicates.java': `package c;
import static java.util.Arrays.asList;
import static org.junit.Assert.*;
public final class Predicates {
  static Object all(Object... xs) { return asList(xs); }
  static void check() { assertTrue(true); }
  static class Inner { Object go() { return asList(1, 2); } }
}`,
  };
  it('silinmiş dış üye için iç sınıfın kendi metoduna giden çağrı ve statik import bulunmaz', async () => {
    const { idx } = await build(FILES);
    // ImmutableMap#createEntrySet() silinmiş: iç sınıftaki self çağrı kendi metoduna bağlı
    expect(idx.findCallsTo('c.ImmutableMap', 'createEntrySet', 0)).toEqual([]);
    expect(idx.targetsOfCallSite('c.ImmutableMap.IteratorBasedImmutableMap#entrySet()', 7, 'createEntrySet')).toEqual([
      'c.ImmutableMap.IteratorBasedImmutableMap#createEntrySet()',
    ]);
    // Predicates#asList silinmiş: alıcısız asList(..) java.util.Arrays statik importuna gider
    expect(idx.findCallsTo('c.Predicates', 'asList')).toEqual([]);
    // wildcard statik import (repo dışı): emin olunamaz → likely
    expect(idx.findCallsTo('c.Predicates', 'assertTrue', 1).map((r) => r.confidence)).toEqual(['likely']);
    // mevcut üyeye kendi sahibinde bağlı çağrı hâlâ bulunur
    expect(idx.findCallsTo('c.ImmutableMap', 'createKeySet', 0).map((r) => r.fromId)).toEqual(['c.ImmutableMap#keySet()']);
  });
});

describe('B3: aynı FQN birden çok kaynak kökünde', () => {
  const FILES = {
    'guava/src/com/g/base/Pre.java': 'package com.g.base;\npublic final class Pre {\n  public static void check(boolean b) {}\n  public static void onlyMain() {}\n}\n',
    'android/guava/src/com/g/base/Pre.java': 'package com.g.base;\npublic final class Pre {\n  public static void check(boolean b) {}\n  public static void onlyAndroid() {}\n}\n',
    'guava/src/com/g/base/Use.java': 'package com.g.base;\nclass Use {\n  void a() { Pre.check(true); Pre.onlyMain(); }\n}\n',
    'android/guava/src/com/g/base/Use.java': 'package com.g.base;\nclass Use {\n  void a() { Pre.check(true); Pre.onlyAndroid(); }\n}\n',
    'android/guava/src/com/g/base/Sub.java': 'package com.g.base;\nclass Sub extends Base {\n}\n',
    'android/guava/src/com/g/base/Base.java': 'package com.g.base;\nclass Base {\n  void android() {}\n}\n',
    'guava/src/com/g/base/Base.java': 'package com.g.base;\nclass Base {\n  void main() {}\n}\n',
  };
  it('tüm adaylar tutulur; çözümleme aynı kaynak kökünü tercih eder; varsayılan en kısa kök', async () => {
    const { idx } = await build(FILES);
    expect(idx.typesByFqn('com.g.base.Pre').map((x) => x.file.path).sort()).toEqual([
      'android/guava/src/com/g/base/Pre.java',
      'guava/src/com/g/base/Pre.java',
    ]);
    expect(idx.getFileOfType('com.g.base.Pre')?.path).toBe('guava/src/com/g/base/Pre.java');
    expect(idx.getMember('com.g.base.Pre#check(boolean)')?.file.path).toBe('guava/src/com/g/base/Pre.java');
    // android flavor'daki çağrılar android adayına bağlanır (onlyAndroid yalnız orada)
    const callers = idx.callersOf('com.g.base.Pre#onlyAndroid()');
    expect(callers.map((c) => `${c.file}:${c.confidence}`)).toEqual(['android/guava/src/com/g/base/Use.java:exact']);
    expect(idx.callersOf('com.g.base.Pre#onlyMain()').map((c) => c.file)).toEqual(['guava/src/com/g/base/Use.java']);
    expect(idx.callersOf('com.g.base.Pre#check(boolean)').map((c) => c.file).sort()).toEqual([
      'android/guava/src/com/g/base/Use.java',
      'guava/src/com/g/base/Use.java',
    ]);
    // üst tip: android Sub -> android Base
    const sub = idx.files.get('android/guava/src/com/g/base/Sub.java') as JavaFileModel;
    expect(idx.resolveTypeName('Base', sub)).toBe('com.g.base.Base');
    expect(idx.subTypesOf('com.g.base.Base')).toEqual(['com.g.base.Sub']);
    expect(idx.typesByFqn('com.g.yok')).toEqual([]);
  });

  it('sourceRootOf: paket adıyla kesin, yoksa sezgisel', () => {
    expect(sourceRootOf('android/guava/src/com/google/common/base/X.java', 'com.google.common.base')).toBe('android/guava/src');
    expect(sourceRootOf('android/guava/src/com/google/common/base/X.java')).toBe('android/guava/src');
    expect(sourceRootOf('core/src/main/java/org/a/X.java')).toBe('core/src/main/java');
    expect(sourceRootOf('X.java', '')).toBe('');
    expect(sourceRootOf('com/a/X.java', 'com.a')).toBe('');
    expect(sourceRootOf('guava-gwt/src-super/com/g/base/super/com/g/base/X.java', 'com.g.base')).toBe(
      'guava-gwt/src-super/com/g/base/super',
    );
    expect(sourceRootOf('guava-gwt/src-super/com/g/base/super/com/g/base/X.java')).toBe('guava-gwt/src-super/com/g/base/super');
  });
});

describe('B13: filesReferencingType ek referans biçimleri', () => {
  it('alan erişimi niteleyicisi, statik çağrı alıcısı, anotasyon argümanı, X.class, generic ve cast', async () => {
    const { idx } = await build({
      'src/t/TimeZones.java': 'package t;\npublic class TimeZones {\n  public static final String GMT_ID = "GMT";\n  public static final Object GMT = null;\n  public static Object get() { return null; }\n}\n',
      'src/t/Marker.java': 'package t;\npublic class Marker {}\n',
      'src/u/A.java': 'package u;\nimport t.*;\nclass A {\n  Object f() { return TimeZones.GMT; }\n}\n',
      'src/u/B.java': 'package u;\nimport t.*;\n@DefaultTimeZone(TimeZones.GMT_ID)\nclass B {}\n',
      'src/u/C.java': 'package u;\nimport t.*;\nclass C {\n  Object c = Marker.class;\n}\n',
      'src/u/D.java': 'package u;\nimport t.*;\nclass D {\n  java.util.List<Marker> l;\n  Object x(Object o) { return (Marker) o; }\n}\n',
      'src/u/E.java': 'package u;\nimport t.*;\nclass E {\n  // TimeZones yalnız yorumda\n  String s = "Marker";\n}\n',
      'src/u/F.java': 'package u;\nimport t.*;\nimport other.TimeZones;\nclass F {\n  Object f() { return TimeZones.GMT; }\n}\n',
    });
    expect(idx.filesReferencingType('t.TimeZones')).toEqual(['src/u/A.java', 'src/u/B.java']);
    expect(idx.filesReferencingType('t.Marker')).toEqual(['src/u/C.java', 'src/u/D.java']);
  });
});

describe('Anonim sınıflar', () => {
  it('anonim implementasyonlar overriddenBy sonucunda sentetik id ile görünür', async () => {
    const { idx } = await build({
      'src/a/Listener.java': 'package a;\npublic interface Listener<E> {\n  void onEvent(E e);\n  void other();\n}\n',
      'src/a/Bus.java': `package a;
class Bus {
  Listener<String> l = new Listener<String>() {
    public void onEvent(String s) {}
    public void other() {}
  };
  void reg() {
    run(new Listener<Integer>() { public void onEvent(Integer i) {} public void other() {} });
  }
  void run(Listener<?> x) {}
}`,
    });
    expect(idx.overriddenBy('a.Listener#onEvent(E)').sort()).toEqual([
      'a.Bus#l$anon1#onEvent(String)',
      'a.Bus#reg()$anon1#onEvent(Integer)',
    ]);
  });

  it('anonim gövdede üye sırası değişimi başlatıcıyı modified yapmaz', async () => {
    const o = await parseJavaFile(
      'A.java',
      'class A {\n  Runnable r = new Runnable() {\n    int n = 1;\n    public void run() { go(); }\n    void go() {}\n  };\n}\n',
    );
    const n = await parseJavaFile(
      'A.java',
      'class A {\n  Runnable r = new Runnable() {\n    void go() {}\n    public void run() { go(); }\n    int n = 1;\n  };\n}\n',
    );
    const d = diffJavaFile(o, n)[0] as TypeDiff;
    expect(d.members[0]?.change.status).toBe('cosmetic');
    const n2 = await parseJavaFile(
      'A.java',
      'class A {\n  Runnable r = new Runnable() {\n    void go() {}\n    public void run() { go(); go(); }\n    int n = 1;\n  };\n}\n',
    );
    expect(diffJavaFile(o, n2)[0]?.members[0]?.change.status).toBe('modified');
  });
});

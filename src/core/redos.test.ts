/**
 * Felaket geri izleme (ReDoS) gerilemeleri: güvenilmeyen Java kaynağı / diff metni üzerinde çalışan desenler
 * 50 000 karakterlik kötü niyetli girdilerde doğrusal kalmalı. Sonuç doğruluğu her zaman, süre sınırı (100 ms)
 * yalnız performans modunda doğrulanır. `REDOS_OUT` verilirse ölçüm tablosu o dosyaya yazılır.
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { sqlLiterals } from './analysis/risk.js';
import { extractCodeAnnotations, maskCommentsAndStrings } from './analysis/util.js';
import { methodNameFromHunkHeader } from './buildReview.js';
import { looksLikeSql, parseJavaFile } from './java/extract.js';
import { maskVarargsAnnotations } from './java/mask.js';
import { baseTypeName, eraseTypeForId, isTestPath, referencedSimpleNames, splitArraySuffix, stripAnnotations } from './java/names.js';
import { NORM_TOKEN_RE, RAW_TOKEN_RE } from './java/semanticDiff.js';
import { perfMode } from './testing/perfMode.js';

const N = 50_000;
const LIMIT_MS = 100;
/** Uçtan uca ayrıştırma ~25 000 düğümlü ağaç kurar (doğrusal iş); tek desen sınırı yerine daha geniş sınır. */
const PARSE_LIMIT_MS = 1_000;
const rows: string[] = [];
const rep = (s: string, len = N) => s.repeat(Math.ceil(len / s.length)).slice(0, len);

async function timed<T>(label: string, fn: () => T | Promise<T>, limit = LIMIT_MS): Promise<T> {
  const t = performance.now();
  const r = await fn();
  const ms = performance.now() - t;
  rows.push(`${label}\t${ms.toFixed(1)} ms`);
  if (perfMode()) expect(ms, label).toBeLessThan(limit);
  return r;
}

afterAll(() => {
  if (process.env.REDOS_OUT) writeFileSync(process.env.REDOS_OUT, rows.join('\n'));
});

describe('ReDoS: 50 000 karakterlik kötü girdiler', () => {
  it('SQL tespiti (literal içinde fiil var, yan cümle yok)', async () => {
    expect(await timed('extract looksLikeSql: "select " x N', () => looksLikeSql(`"${rep('select ')}"`))).toBe(false);
    expect(looksLikeSql('"SELECT a FROM t"')).toBe(true);
    expect(looksLikeSql('"from x select"')).toBe(false);
    const lits = await timed('risk sqlLiterals: \'"\\\' x N (kapanmayan)', () => sqlLiterals(rep('"\\')));
    expect(lits).toEqual([]);
    expect(sqlLiterals('String q = "select * from t"; String r = "x";')).toEqual(['"select * from t"']);
  });

  it('yorum/string maskeleme ve kod anotasyonları', async () => {
    expect((await timed('util maskCommentsAndStrings: "/*" x N', () => maskCommentsAndStrings(rep('/*')))).length).toBe(N);
    expect(await timed('util extractCodeAnnotations: "@A(" x N', () => extractCodeAnnotations(rep('@A(')))).toHaveLength(1);
  });

  it('varargs anotasyon maskesi (kapanmayan @A( dizisi)', async () => {
    expect(await timed('mask maskVarargsAnnotations: "@A(" x N + "..."', () => maskVarargsAnnotations(`${rep('@A(')}...`))).toBeUndefined();
    const ok = maskVarargsAnnotations('void f(Object @A(x) ... args) {}');
    expect(ok?.source).toBe('void f(Object       ... args) {}');
  });

  it('token desenleri (kapanmayan literal)', async () => {
    const raw = await timed('semanticDiff RAW_TOKEN_RE: \'"a\\\' x N', () => rep('"a\\').match(RAW_TOKEN_RE));
    expect(raw).toHaveLength(1);
    const norm = await timed('semanticDiff NORM_TOKEN_RE: \'"a\\\' x N', () => rep('"a\\').match(NORM_TOKEN_RE));
    expect(norm).toHaveLength(1);
    expect('return "a b" + \'c\';'.match(RAW_TOKEN_RE)).toEqual(['return', '"a b"', '+', "'c'", ';']);
  });

  it('hunk başlığından metot adı', async () => {
    expect(await timed('buildReview methodNameFromHunkHeader: "a(" x N + ")x"', () => methodNameFromHunkHeader(`${rep('a(')})x`))).toBeUndefined();
    expect(await timed('buildReview methodNameFromHunkHeader: "f() throws " + "a " x N + "x("', () => methodNameFromHunkHeader(`f() throws ${rep('a ')}x(`))).toBe('x');
    expect(methodNameFromHunkHeader('public Order place(Order o, int q) throws IOException, a.B {')).toBe('place');
    expect(methodNameFromHunkHeader('void şubeKapat()')).toBe('şubeKapat');
    expect(methodNameFromHunkHeader('public class Foo {')).toBeUndefined();
    expect(methodNameFromHunkHeader('if (a) {')).toBe('if');
    expect(methodNameFromHunkHeader('a(b) c(')).toBe('c');
  });

  it('dizi/varargs soneki ve tip adları', async () => {
    expect((await timed('names splitArraySuffix: "[]" x N + "x"', () => splitArraySuffix(`${rep('[]')}x`))).suffix).toBe('');
    expect(splitArraySuffix('List[][]...')).toEqual({ base: 'List', suffix: '[][]...' });
    expect(await timed('names eraseTypeForId: "a.b<" x N', () => eraseTypeForId(rep('a.b<')))).toBe('b');
    expect(baseTypeName('java.util.List<X>[]')).toBe('java.util.List');
    expect(await timed('names stripAnnotations: "@a." x N', () => stripAnnotations(rep('@a.')))).not.toContain('@');
    expect((await timed('names referencedSimpleNames: "A . " x N', () => referencedSimpleNames(rep('A . ')))).length).toBeGreaterThan(0);
    expect(await timed('names isTestPath: "/a-a" x N', () => isTestPath(rep('/a-a')))).toBe(false);
  });

  it('uçtan uca ayrıştırma: tek satırlık 50 000 karakterlik dosyalar', async () => {
    await parseJavaFile('W.java', 'class W {}'); // ayrıştırıcı ısınması (wasm yükleme) ölçüme girmesin
    const m1 = await timed('parseJavaFile: tek satır, "a+" ifadesi', () => parseJavaFile('A.java', `class A { int f() { return ${rep('a+')}1; } }`), PARSE_LIMIT_MS);
    expect(m1.types[0]?.members).toHaveLength(1);
    const m2 = await timed('parseJavaFile: tek satır, "select " string literali', () => parseJavaFile('B.java', `class B { String s = "${rep('select ')}"; }`), PARSE_LIMIT_MS);
    expect(m2.types[0]?.members[0]?.features.sqlStrings).toBe(0);
    const m3 = await timed('parseJavaFile: tek satır, "@A(" x N + "..."', () => parseJavaFile('C.java', `class C { void f(Object ${rep('@A(')}... a) {} }`), PARSE_LIMIT_MS);
    expect(m3.hasErrors).toBe(true);
  });
});

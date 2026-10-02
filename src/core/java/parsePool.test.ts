import { afterAll, describe, expect, it } from 'vitest';
import { parseJavaFile } from './extract.js';
import {
  clearParseCache,
  closeParsePool,
  configureParseCache,
  parseCacheStats,
  parseJavaFiles,
  parsePoolStats,
} from './parsePool.js';

function file(i: number): { path: string; source: string; cacheKey: string } {
  const source = `package p${i % 5};
import java.util.*;
public class C${i} {
  private final List<String> names = new ArrayList<>();
  public int op(int a, Object @Deprecated ... rest) {
    if (a > ${i}) { return Objects.hashCode(names) + a; }
    for (String n : names) { if (n != null) a += n.length(); }
    return a;
  }
  Runnable r = new Runnable() { public void run() { op(1); } };
}
`;
  return { path: `src/p${i % 5}/C${i}.java`, source, cacheKey: `sha${i}` };
}

afterAll(async () => {
  await closeParsePool();
  clearParseCache();
});

describe('parseJavaFiles: işçi havuzu + önbellek', () => {
  it('havuz sonuçları ana thread ile birebir aynı ve girdi sırasıyla; ikinci çağrı önbellekten', { timeout: 60_000 }, async () => {
    clearParseCache();
    const items = Array.from({ length: 64 }, (_, i) => file(i));
    const progress: number[] = [];
    const pooled = await parseJavaFiles(items, { concurrency: 3, onProgress: (d, t) => progress.push(d / t) });
    const direct = await Promise.all(items.map((it) => parseJavaFile(it.path, it.source)));
    expect(pooled).toEqual(direct);
    expect(pooled.map((m) => m.path)).toEqual(items.map((i) => i.path));
    expect(pooled.every((m) => !m.hasErrors)).toBe(true);
    const ps = parsePoolStats();
    expect(ps.workerBatches).toBeGreaterThan(0); // gerçekten işçide ayrıştı (TS kaynak: tsx yükleyicisiyle)
    expect(ps.mainFallbackBatches).toBe(0);
    expect(progress.at(-1)).toBe(1);
    const before = parseCacheStats();
    expect(before.entries).toBe(64);
    const again = await parseJavaFiles(items, { concurrency: 3 });
    expect(again[5]).toBe(pooled[5]); // aynı nesne (önbellek)
    expect(parseCacheStats().hits - before.hits).toBe(64);
    // aynı içerik farklı yol: ayrı anahtar
    const moved = await parseJavaFiles([{ ...(items[0] as { path: string; source: string; cacheKey: string }), path: 'x/C0.java' }]);
    expect(moved[0]?.path).toBe('x/C0.java');
  });

  it('küçük girdi ana thread’de; önbellek sınırı LRU ile uygulanır', async () => {
    clearParseCache();
    configureParseCache({ maxEntries: 3 });
    try {
      const items = Array.from({ length: 5 }, (_, i) => file(100 + i));
      const res = await parseJavaFiles(items, { concurrency: 4 });
      expect(res).toHaveLength(5);
      expect(parseCacheStats().entries).toBe(3);
      const noKey = await parseJavaFiles([{ path: 'a/A.java', source: 'class A {}' }]);
      expect(noKey[0]?.types[0]?.fqn).toBe('A');
      expect(parseCacheStats().entries).toBe(3);
    } finally {
      configureParseCache({ maxEntries: 20_000 });
    }
  });
});

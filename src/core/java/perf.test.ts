import { afterAll, describe, expect, it } from 'vitest';
import { parseJavaFile } from './extract.js';
import { clearParseCache, closeParsePool, defaultParseConcurrency, parseJavaFiles, parsePoolStats } from './parsePool.js';
import type { JavaFileModel } from './model.js';
import { RepoIndex } from './repoIndex.js';
import { diffJavaFile } from './semanticDiff.js';

const FILE_COUNT = 3000;

function syntheticFile(i: number): { path: string; source: string } {
  const pkg = `com.acme.m${i % 30}`;
  const dep = (i + 1) % FILE_COUNT;
  const depPkg = `com.acme.m${dep % 30}`;
  const base = i % 10 === 0 ? '' : ` extends Base${i - (i % 10)}`;
  const methods: string[] = [];
  for (let k = 0; k < 15; k++) {
    methods.push(`
    /** Metot ${k}. */
    public int op${k}(int a, java.util.List<String> names) {
        int sum = a;
        for (String n : names) {
            if (n != null && !n.isEmpty()) {
                sum += helper${k % 3}(n.length());
            }
        }
        dep.op${(k + 1) % 15}(sum, names);
        return sum > 10 ? sum : -sum;
    }`);
  }
  const source = `package ${pkg};

import ${depPkg}.Service${dep};
import java.util.*;

public class ${i % 10 === 0 ? `Base${i}` : `Service${i}`}${base} {
    private final Service${dep} dep;
    private int counter = 0, other = 1;

    public ${i % 10 === 0 ? `Base${i}` : `Service${i}`}(Service${dep} dep) {
        this.dep = dep;
    }
${methods.join('\n')}

    protected int helper0(int x) { return x + 1; }
    protected int helper1(int x) { return x * 2; }
    protected int helper2(int x) { return x - 3; }
}
`;
  return { path: `src/${pkg.replace(/\./g, '/')}/Service${i}.java`, source };
}

describe('performans', () => {
  it(`${FILE_COUNT} sentetik dosya: ayrıştırma + indeks + diff 20 sn altında`, { timeout: 60_000 }, async () => {
    const inputs = Array.from({ length: FILE_COUNT }, (_, i) => syntheticFile(i));
    const t0 = performance.now();
    const models: JavaFileModel[] = [];
    for (const f of inputs) models.push(await parseJavaFile(f.path, f.source));
    const t1 = performance.now();
    const idx = RepoIndex.build(models);
    const t2 = performance.now();
    let changed = 0;
    for (let i = 0; i < 300; i++) {
      const f = inputs[i] as { path: string; source: string };
      const modified = await parseJavaFile(f.path, f.source.replace('return sum > 10', 'return sum > 20'));
      changed += diffJavaFile(models[i], modified).filter((d) => d.change.status !== 'unchanged').length;
    }
    const t3 = performance.now();
    const members = models.reduce((n, m) => n + m.types.reduce((k, t) => k + t.members.length, 0), 0);
    // eslint-disable-next-line no-console
    console.log(
      `[perf] ${FILE_COUNT} dosya / ${members} üye: ayrıştırma ${(t1 - t0).toFixed(0)} ms, ` +
        `indeks ${(t2 - t1).toFixed(0)} ms, 300 diff ${(t3 - t2).toFixed(0)} ms`,
    );
    expect(models.every((m) => !m.hasErrors)).toBe(true);
    expect(changed).toBe(300);
    expect(idx.callersOf('com.acme.m1.Service1#op1(int,List)').length).toBeGreaterThan(0);
    // Mutlak süre sınırı yalnız `npm run test:perf` (tek başına, REVIEWIST_PERF=1) ile uygulanır;
    // tam test seti paralel koşarken CPU paylaşıldığı için bu sınır kararsız olur.
    if (process.env.REVIEWIST_PERF === '1' || process.env.npm_lifecycle_event === 'test:perf') expect(t3 - t0).toBeLessThan(20_000);
  });
});

describe('performans: ayrıştırma havuzu + önbellek', () => {
  afterAll(async () => {
    await closeParsePool();
    clearParseCache();
  });

  it(`${FILE_COUNT} sentetik dosya: tek thread vs havuz vs önbellek`, { timeout: 120_000 }, async () => {
    clearParseCache();
    const inputs = Array.from({ length: FILE_COUNT }, (_, i) => ({ ...syntheticFile(i), cacheKey: `blob${i}` }));
    const t0 = performance.now();
    const single = await parseJavaFiles(inputs.map(({ path, source }) => ({ path, source })), { concurrency: 1 });
    const t1 = performance.now();
    const pooled = await parseJavaFiles(inputs);
    const t2 = performance.now();
    const cached = await parseJavaFiles(inputs);
    const t3 = performance.now();
    // eslint-disable-next-line no-console
    console.log(
      `[perf] ${FILE_COUNT} dosya: tek thread ${(t1 - t0).toFixed(0)} ms, havuz (${defaultParseConcurrency()} işçi, ısınma dahil) ` +
        `${(t2 - t1).toFixed(0)} ms, önbellek ${(t3 - t2).toFixed(0)} ms; ${JSON.stringify(parsePoolStats())}`,
    );
    expect(pooled).toEqual(single);
    expect(cached).toHaveLength(FILE_COUNT);
    expect(cached[10]).toBe(pooled[10]);
    expect(t3 - t2).toBeLessThan((t2 - t1) / 10);
  });
});

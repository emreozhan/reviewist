import { describe, expect, it } from 'vitest';
import type { FileChange } from '../shared/types.js';
import { buildReviewPlan } from './analysis/reviewPlan.js';
import { buildReview } from './buildReview.js';
import { jMember, jType, memberDiff, typeDiff } from './testing/builders.js';
import { createSyntheticChangeSet } from './testing/synthetic.js';
import type { TypeDiff } from './java/model.js';
import { emptyRisk } from './analysis/util.js';
import { perfMode } from './testing/perfMode.js';

const fmt = (ms: number) => `${ms.toFixed(0)} ms`;

describe('performans — buildReview uçtan uca', () => {
  it('4000 dosyalık indeks + 150 değişen dosya', { timeout: 120_000 }, async () => {
    const { cs, changedPaths, totalJava } = createSyntheticChangeSet({ indexFiles: 4000, changedFiles: 150 });
    const messages: string[] = [];
    let timings: Readonly<Record<string, number>> = {};
    let reads = 0;
    const counted = { ...cs, readFile: (side: 'old' | 'new', path: string) => (reads++, cs.readFile(side, path)) };
    const t0 = performance.now();
    const model = await buildReview(counted, { onProgress: (m) => messages.push(m), onTimings: (t) => (timings = t) });
    const total = performance.now() - t0;
    console.log(
      `[perf] buildReview ${totalJava} java / ${changedPaths.length} değişen: toplam ${fmt(total)} — ` +
        Object.entries(timings)
          .map(([k, v]) => `${k} ${fmt(v)}`)
          .join(', ') +
        ` — readFile çağrısı ${reads}, ilerleme mesajı ${messages.length}, grup ${model.groups.length}, graf ${model.graph.nodes.length} düğüm`,
    );
    expect(model.files.length).toBe(changedPaths.length);
    expect(model.files.every((f) => !f.parseError)).toBe(true);
    // Değişen dosyaların head hali indeks için yeniden okunmaz: her değişen dosya 2 (old+new), diğerleri 1 kez okunur.
    expect(reads).toBe(totalJava + changedPaths.length);
    // İmza değişen port → implementasyon ve çağıranlar bulunur
    const port = model.types.find((t) => t.name === 'Store0Port');
    const load = port?.members.find((m) => m.name === 'load');
    expect(load?.status).toBe('signatureChanged');
    expect(load?.overriddenBy.length).toBeGreaterThan(0);
    // İlerleme mesajları spam değil
    expect(messages.filter((m) => m.startsWith('Repo indeksi:')).length).toBeLessThanOrEqual(12);
    if (perfMode()) expect(total).toBeLessThan(60_000);
  });
});

describe('performans — okuma planı', () => {
  it.each([
    ['zincir + döngü bağımlılıkları', true],
    ['bağımsız dosyalar (eski algoritmanın en kötü durumu)', false],
  ])('3000 dosyalık plan: %s', { timeout: 60_000 }, (label, withDeps) => {
    const N = 3000;
    const files: FileChange[] = [];
    const byFile = new Map<string, TypeDiff[]>();
    for (let i = 0; i < N; i++) {
      const path = `src/main/java/p/C${i}.java`;
      const fqn = `p.C${i}`;
      // Her metot bir sonrakini çağırır (zincir); her 50'de bir geriye çağrı (döngü)
      const callees = withDeps ? [`p.C${(i + 1) % N}#run()`] : [];
      if (withDeps && i % 50 === 49) callees.push(`p.C${i - 49}#run()`);
      const m = jMember({ ownerFqn: fqn, name: 'run' });
      const md = memberDiff({ status: 'modified', oldMember: m, newMember: m });
      md.change.callees = callees;
      md.change.risk = { score: i % 97, level: 'low', reasons: [] };
      const t = jType({ fqn, members: [m] });
      const td = typeDiff({ status: 'modified', oldType: t, newType: t, members: [md], file: path });
      byFile.set(path, [td]);
      files.push({
        id: path,
        path,
        status: 'modified',
        language: 'java',
        binary: false,
        additions: 1,
        deletions: 1,
        hunks: [],
        layer: 'service',
        isTest: false,
        cosmeticOnly: false,
        typeIds: [fqn],
        relatedTestFiles: [],
        risk: { ...emptyRisk(), score: i % 97 },
        reviewOrder: 0,
        packageName: 'p',
      });
    }
    const t0 = performance.now();
    const steps = buildReviewPlan(files, byFile);
    const ms = performance.now() - t0;
    console.log(`[perf] okuma planı ${N} dosya (${label}): ${fmt(ms)}`);
    expect(steps.length).toBe(N);
    if (!withDeps) {
      // Bağımlılık yoksa sıra yalnızca önceliğe (risk skoru azalan, sonra yol) göre
      const scores = steps.map((st) => files.find((f) => f.path === st.fileId)?.risk.score ?? -1);
      for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
    expect(new Set(steps.map((s) => s.fileId)).size).toBe(N);
    if (perfMode()) expect(ms).toBeLessThan(5_000);
  });
});

import { describe, expect, it } from 'vitest';
import type { ImpactGraph, ReviewModel } from '../../../src/shared/types';
import { GROUP, S, T } from '../mock/ids';
import { sampleReview } from '../mock/sampleReview';
import { computeLayout, defaultGraphFilter, layoutInput, nodeWidth, NODE_HEIGHT, selectSubgraph } from './graphLayout';

const base = { groupId: null, onlyHighRisk: false, hops: 1, hideContains: false };

describe('selectSubgraph', () => {
  it('filtre yokken tüm grafı döndürür', () => {
    const sub = selectSubgraph(sampleReview.graph, sampleReview.groups, base);
    expect(sub.nodes).toHaveLength(sampleReview.graph.nodes.length);
  });

  it('grup filtresi grup sembolleri + 1 komşu verir', () => {
    const sub = selectSubgraph(sampleReview.graph, sampleReview.groups, { ...base, groupId: GROUP.notifier, hideContains: true });
    const ids = new Set(sub.nodes.map((n) => n.id));
    expect(ids.has(S.anNotify)).toBe(true);
    expect(ids.has(T.EMAIL)).toBe(true);
    expect(ids.has(S.pgCharge)).toBe(false);
    for (const e of sub.edges) {
      expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
      expect(e.kind).not.toBe('contains');
    }
  });

  it('yalnız yüksek risk seed olarak yüksek riskli düğümleri alır', () => {
    const sub = selectSubgraph(sampleReview.graph, sampleReview.groups, { ...base, onlyHighRisk: true, hops: 0 });
    expect(sub.nodes.length).toBeGreaterThan(0);
    expect(sub.nodes.every((n) => n.riskLevel === 'high' || n.riskLevel === 'critical')).toBe(true);
  });

  it('varsayılan filtre: seçili sembolün grubu, yoksa en riskli grup; grup yoksa büyük grafta yüksek risk', () => {
    expect(defaultGraphFilter(sampleReview).groupId).toBe(GROUP.payment);
    expect(defaultGraphFilter(sampleReview, S.anNotify).groupId).toBe(GROUP.notifier);
    const nodes = Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, kind: 'method' as const, status: 'modified' as const, layer: 'domain' as const, riskLevel: 'low' as const }));
    const big: ReviewModel = { ...sampleReview, groups: [], graph: { nodes, edges: [] } };
    expect(defaultGraphFilter(big)).toMatchObject({ groupId: null, onlyHighRisk: true });
    expect(defaultGraphFilter({ ...sampleReview, groups: [] })).toMatchObject({ groupId: null, onlyHighRisk: false });
  });
});

describe('graf yerleşimi', () => {
  it('düğüm genişliği etiket uzunluğuyla sınırlı biçimde büyür', () => {
    expect(nodeWidth('A')).toBe(140);
    expect(nodeWidth('x'.repeat(200))).toBe(340);
  });

  it('kalıtım kenarlarını üst tip solda kalacak şekilde ters çevirir', () => {
    const g: ImpactGraph = {
      nodes: [
        { id: 'P', label: 'Parent', kind: 'class', status: 'modified', layer: 'domain', riskLevel: 'low' },
        { id: 'C', label: 'Child', kind: 'class', status: 'impacted', layer: 'domain', riskLevel: 'low' },
      ],
      edges: [{ id: 'e', from: 'C', to: 'P', kind: 'extends' }],
    };
    const input = layoutInput(g);
    expect(input.edges[0]).toMatchObject({ from: 'P', to: 'C' });
    expect(input.nodes[0]?.height).toBe(NODE_HEIGHT);
    const pos = computeLayout(input);
    expect((pos.get('P')?.x ?? 0) < (pos.get('C')?.x ?? 0)).toBe(true);
  });

  it('300+ düğümde makul sürede yerleşim üretir', () => {
    const n = 320;
    const g: ImpactGraph = {
      nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Type${i}.method${i}()`, kind: 'method' as const, status: 'modified' as const, layer: 'domain' as const, riskLevel: 'low' as const })),
      edges: Array.from({ length: n - 1 }, (_, i) => ({ id: `e${i}`, from: `n${Math.floor(i / 3)}`, to: `n${i + 1}`, kind: 'calls' as const })),
    };
    const t0 = performance.now();
    const pos = computeLayout(layoutInput(g));
    const ms = performance.now() - t0;
    expect(pos.size).toBe(n);
    expect(ms).toBeLessThan(5000);
  });
});

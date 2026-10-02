/**
 * Gruplama, okuma planı, etki grafiği, kozmetik ve zenginleştirme birim testleri (A1'siz, elle kurulmuş modeller).
 */
import { describe, expect, it } from 'vitest';
import type { CallRef, FileChange, Layer, RiskInfo } from '../../shared/types.js';
import type { TypeDiff } from '../java/model.js';
import { jFile, jMember, jType, memberDiff, typeDiff } from '../testing/builders.js';
import { FakeRepoIndex } from '../testing/fakeRepoIndex.js';
import type { AnalysisContext, AnalyzedFile } from './context.js';
import { cosmeticFindings, isCosmeticJava, isWhitespaceOnly } from './cosmetic.js';
import { enrich, registerSymbols } from './enrich.js';
import { buildGraph } from './graph.js';
import { buildGroups } from './grouping.js';
import { buildReviewPlan } from './reviewPlan.js';
import { emptyRisk, makeRisk } from './util.js';

const risk = (score: number): RiskInfo => makeRisk([{ code: 't', message: 't', weight: score }]);
const call = (fromId: string, file: string, line = 5, inChangedCode = false): CallRef => ({ fromId, file, line, inChangedCode, confidence: 'exact' });

function fc(path: string, layer: Layer, over: Partial<FileChange> = {}): FileChange {
  return {
    id: path, path, status: 'modified', language: 'java', binary: false, additions: 1, deletions: 1, hunks: [], layer,
    isTest: layer === 'test', cosmeticOnly: false, typeIds: [], relatedTestFiles: [], risk: emptyRisk(), reviewOrder: 0, ...over,
  };
}

/** Port.run(int) → run(int,int) imza değişikliği; A ve B implementasyon; Caller.use diff içinde çağırıyor. */
function scenario() {
  const P = 'com.acme.port.Port';
  const runOld = jMember({ ownerFqn: P, name: 'run', params: [{ name: 'a', type: 'int', varargs: false }] });
  const runNew = jMember({ ownerFqn: P, name: 'run', params: [{ name: 'a', type: 'int', varargs: false }, { name: 'b', type: 'int', varargs: false }] });
  const port = typeDiff({ status: 'modified', oldType: jType({ fqn: P, kind: 'interface', members: [runOld] }), newType: jType({ fqn: P, kind: 'interface', members: [runNew] }), file: 'Port.java', members: [memberDiff({ status: 'signatureChanged', oldMember: runOld, newMember: runNew, flags: ['params'] })] });
  port.change.layer = 'port';
  port.change.subTypes = ['com.acme.a.A', 'com.acme.b.B'];
  const pm = port.members[0].change;
  pm.risk = risk(60);
  pm.overriddenBy = ['com.acme.a.A#run(int,int)', 'com.acme.b.B#run(int,int)'];
  pm.callers = [call('com.acme.app.Caller#use()', 'Caller.java', 7, true), call('com.acme.web.Ctrl#get()', 'Ctrl.java', 9)];

  const impl = (fqn: string, file: string, score: number): TypeDiff => {
    const o = jMember({ ownerFqn: fqn, name: 'run', params: [{ name: 'a', type: 'int', varargs: false }] });
    const n = jMember({ ownerFqn: fqn, name: 'run', params: [{ name: 'a', type: 'int', varargs: false }, { name: 'b', type: 'int', varargs: false }] });
    const td = typeDiff({ status: 'modified', oldType: jType({ fqn, interfaces: ['Port'] }), newType: jType({ fqn, interfaces: ['Port'] }), file, members: [memberDiff({ status: 'signatureChanged', oldMember: o, newMember: n, flags: ['params'] })] });
    td.change.superTypes = [P];
    td.change.layer = 'adapter-out';
    td.members[0].change.overrides = [`${P}#run(int,int)`];
    td.members[0].change.risk = risk(score);
    return td;
  };
  const a = impl('com.acme.a.A', 'A.java', 35);
  const b = impl('com.acme.b.B', 'B.java', 34);

  const C = 'com.acme.app.Caller';
  const use = jMember({ ownerFqn: C, name: 'use' });
  const caller = typeDiff({ status: 'modified', oldType: jType({ fqn: C }), newType: jType({ fqn: C }), file: 'Caller.java', members: [memberDiff({ status: 'modified', oldMember: use, newMember: use, flags: ['body'] })] });
  caller.change.layer = 'application';
  caller.members[0].change.callees = [`${P}#run(int,int)`];
  caller.members[0].change.risk = risk(10);

  const U = 'com.acme.util.Fmt';
  const f = jMember({ ownerFqn: U, name: 'pad' });
  const lone = typeDiff({ status: 'modified', oldType: jType({ fqn: U }), newType: jType({ fqn: U }), file: 'Fmt.java', members: [memberDiff({ status: 'modified', oldMember: f, newMember: f, flags: ['body'] })] });
  lone.change.layer = 'util';
  lone.members[0].change.risk = risk(5);

  const K = 'com.acme.util.Pretty';
  const k = jMember({ ownerFqn: K, name: 'x' });
  const cos = typeDiff({ status: 'cosmetic', oldType: jType({ fqn: K }), newType: jType({ fqn: K }), file: 'Pretty.java', members: [memberDiff({ status: 'cosmetic', oldMember: k, newMember: k, flags: ['formatting'] })] });

  const TT = 'com.acme.app.CallerTest';
  const t = jMember({ ownerFqn: TT, name: 'shouldUse' });
  const test = typeDiff({ status: 'modified', oldType: jType({ fqn: TT }), newType: jType({ fqn: TT }), file: 'CallerTest.java', members: [memberDiff({ status: 'modified', oldMember: t, newMember: t, flags: ['body'] })] });
  test.change.layer = 'test';
  test.members[0].change.callees = [`${C}#use()`];

  const files = [
    fc('Caller.java', 'application', { risk: risk(10), relatedTestFiles: ['CallerTest.java'] }),
    fc('Pretty.java', 'util', { cosmeticOnly: true }),
    fc('B.java', 'adapter-out', { risk: risk(34) }),
    fc('CallerTest.java', 'test'),
    fc('A.java', 'adapter-out', { risk: risk(35) }),
    fc('application.yml', 'resource', { language: 'yaml', risk: risk(30) }),
    fc('Fmt.java', 'util', { risk: risk(5) }),
    fc('Port.java', 'port', { risk: risk(60) }),
  ];
  const diffs = [port, a, b, caller, lone, cos, test];
  return { diffs, files, port, a, b, caller };
}

describe('buildGroups', () => {
  it('bağlı bileşenler, başlık, küçük ve kozmetik gruplar, groupId', () => {
    const { diffs, files, port, a, caller } = scenario();
    const groups = buildGroups(diffs, files);
    const main = groups[0];
    expect(main.title).toBe('Port.run imza değişikliği → 2 implementasyon, 2 çağıran (+4 ilişkili değişiklik)');
    expect(main.symbolIds).toEqual(expect.arrayContaining([port.members[0].change.id, a.members[0].change.id, caller.members[0].change.id, 'com.acme.app.CallerTest#shouldUse()']));
    expect(main.fileIds).toEqual(['A.java', 'B.java', 'Caller.java', 'CallerTest.java', 'Port.java']);
    expect(port.members[0].change.groupId).toBe(main.id);
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual([main.id, 'group:small', 'group:files', 'group:cosmetic']);
    expect(groups.find((g) => g.id === 'group:small')?.symbolIds).toEqual(['com.acme.util.Fmt#pad()']);
    expect(groups.find((g) => g.id === 'group:cosmetic')?.fileIds).toEqual(['Pretty.java']);
    expect(groups.find((g) => g.id === 'group:files')?.fileIds).toEqual(['application.yml']);
  });

  it('gövdesi değişen metodu çağırmak grupları birleştirmez', () => {
    const { diffs, files, caller } = scenario();
    caller.members[0].change.callees = ['com.acme.util.Fmt#pad()'];
    const groups = buildGroups(diffs, files);
    expect(groups.find((g) => g.symbolIds.includes('com.acme.util.Fmt#pad()'))?.id).toBe('group:small');
  });
});

describe('buildReviewPlan', () => {
  it('sözleşme önce, bağımlılık sırası, adapter, yapılandırma, test hemen arkasından, kozmetik en sonda', () => {
    const { diffs, files } = scenario();
    const byFile = new Map<string, TypeDiff[]>();
    for (const td of diffs) byFile.set(td.change.file, [...(byFile.get(td.change.file) ?? []), td]);
    const plan = buildReviewPlan(files, byFile);
    expect(plan.map((s) => s.fileId)).toEqual(['Port.java', 'Caller.java', 'CallerTest.java', 'Fmt.java', 'A.java', 'B.java', 'application.yml', 'Pretty.java']);
    expect(plan[0].reason).toBe('Sözleşme: Port (port arayüzü) — 1 üye imzası değişti; 2 implementasyonu etkiliyor — risk yüksek: t (önce Port.run)');
    expect(plan[1].reason).toContain('önceki adımlardaki Port');
    expect(plan[2].reason).toMatch(/^Test: Caller/);
    expect(plan[7].reason).toContain('hızlıca geçilebilir');
    expect(plan[0].symbolIds).toEqual(['com.acme.port.Port#run(int,int)']);
    expect(files.find((f) => f.path === 'A.java')?.reviewOrder).toBe(5);
  });

  it('döngüde risk sırası', () => {
    const mk = (fqn: string, file: string, callee: string, score: number) => {
      const m = jMember({ ownerFqn: fqn, name: 'f' });
      const td = typeDiff({ status: 'modified', oldType: jType({ fqn }), newType: jType({ fqn }), file, members: [memberDiff({ status: 'modified', oldMember: m, newMember: m, flags: ['body'] })] });
      td.members[0].change.callees = [callee];
      return td;
    };
    const x = mk('com.X', 'X.java', 'com.Y#f()', 10);
    const y = mk('com.Y', 'Y.java', 'com.X#f()', 50);
    const plan = buildReviewPlan([fc('X.java', 'service', { risk: risk(10) }), fc('Y.java', 'service', { risk: risk(50) })], new Map([['X.java', [x]], ['Y.java', [y]]]));
    expect(plan.map((s) => s.fileId)).toEqual(['Y.java', 'X.java']);
  });
});

describe('buildGraph', () => {
  it('değişen + etkilenen düğümler, kenar türleri, kararlı id, kırpma', () => {
    const { diffs, files } = scenario();
    const index = new FakeRepoIndex({
      files: [jFile('src/main/java/com/acme/web/Ctrl.java', [jType({ fqn: 'com.acme.web.Ctrl', members: [jMember({ ownerFqn: 'com.acme.web.Ctrl', name: 'get' })] })])],
    });
    const layerOf = (path: string | undefined): Layer => (path?.includes('/web/') ? 'adapter-in' : 'other');
    const r = buildGraph({ typeDiffs: diffs, files, index, layerOf });
    const ctrl = r.graph.nodes.find((n) => n.id === 'com.acme.web.Ctrl#get()');
    expect(ctrl).toMatchObject({ status: 'impacted', layer: 'adapter-in', riskLevel: 'high', file: 'src/main/java/com/acme/web/Ctrl.java' });
    expect(r.graph.nodes.find((n) => n.id === 'com.acme.app.Caller#use()')?.status).toBe('modified');
    expect(r.graph.nodes.some((n) => n.id === 'com.acme.util.Pretty')).toBe(false);
    const kinds = new Set(r.graph.edges.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(['calls', 'contains', 'implements', 'overrides', 'tests']);
    expect(r.graph.edges.find((e) => e.kind === 'implements')?.id).toBe('implements:com.acme.a.A->com.acme.port.Port');
    expect(r.impactedOutsideDiff).toBe(1);
    const again = buildGraph({ typeDiffs: diffs, files, index, layerOf });
    expect(again.graph.edges.map((e) => e.id)).toEqual(r.graph.edges.map((e) => e.id));

    const small = buildGraph({ typeDiffs: diffs, files, index, layerOf, maxNodes: 3 });
    expect(small.graph.nodes).toHaveLength(3);
    expect(small.truncatedFrom).toBe(r.graph.nodes.length);
    expect(small.graph.nodes.map((n) => n.id)).toContain('com.acme.port.Port#run(int,int)');
    for (const e of small.graph.edges) expect(small.graph.nodes.some((n) => n.id === e.from) && small.graph.nodes.some((n) => n.id === e.to)).toBe(true);
  });
});

describe('kozmetik', () => {
  it('Java: tipler kozmetik ve paket aynı → true; statik import + kod farkı → false', () => {
    const t = jType({ fqn: 'com.acme.A' });
    const o = jFile('A.java', [t], { imports: ['java.util.List', 'java.util.Map'] });
    const n = jFile('A.java', [t], { imports: ['java.util.Map', 'java.util.List'] });
    const td = typeDiff({ status: 'cosmetic', oldType: t, newType: t, file: 'A.java' });
    expect(isCosmeticJava('modified', o, n, [td])).toBe(true);
    expect(isCosmeticJava('added', undefined, n, [td])).toBe(false);
    const moved = jFile('A.java', [t], { packageName: 'com.other' });
    expect(isCosmeticJava('renamed', o, moved, [td])).toBe(false);
    const changed = typeDiff({ status: 'modified', oldType: t, newType: t, file: 'A.java' });
    expect(isCosmeticJava('modified', o, n, [changed])).toBe(false);
  });

  it('Java dışı: yalnızca boşluk', () => {
    const h = (del: string[], add: string[]) => [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '', lines: [...del.map((text) => ({ type: 'del' as const, oldNo: 1, text })), ...add.map((text) => ({ type: 'add' as const, newNo: 1, text }))] }];
    expect(isWhitespaceOnly(h(['a:  1'], ['a: 1']))).toBe(true);
    expect(isWhitespaceOnly(h(['a: 1'], ['a: 2']))).toBe(false);
    expect(isWhitespaceOnly([])).toBe(false);
  });

  it('AI gürültüsü bulgusu', () => {
    const f = cosmeticFindings({ files: 6, cosmeticFiles: ['a', 'b', 'c'], changedMembers: 10, cosmeticMembers: 6 });
    expect(f.map((x) => x.id)).toEqual(['cosmetic:files', 'cosmetic:ai-noise']);
    expect(f[1].message).toContain('%50');
    expect(cosmeticFindings({ files: 10, cosmeticFiles: [], changedMembers: 10, cosmeticMembers: 0 })).toEqual([]);
  });
});

describe('enrich', () => {
  function ctxFor(af: AnalyzedFile[], index: FakeRepoIndex): AnalysisContext {
    return {
      files: af, byPath: new Map(af.map((x) => [x.file.path, x])), typeDiffs: af.flatMap((x) => x.typeDiffs), index, hexagonal: false,
      repoFiles: [], repoFilesKnown: true, members: new Map(), types: new Map(), staleCalls: new Map(), brokenOverrides: new Map(),
      staleTypeRefs: new Map(), architecture: new Map(), warnings: [],
    };
  }

  it('çağıranlar (inChangedCode), polimorfik çağıranlar, eski arity ile çağrı, kırık override', () => {
    const P = 'com.acme.Base';
    const oldM = jMember({ ownerFqn: P, name: 'go', params: [{ name: 'a', type: 'int', varargs: false }] });
    const newM = jMember({ ownerFqn: P, name: 'go', params: [] });
    const baseNew = jType({ fqn: P, members: [newM] });
    const file = jFile('src/Base.java', [baseNew]);
    const sub = jType({ fqn: 'com.acme.Sub', superclass: 'Base', members: [jMember({ ownerFqn: 'com.acme.Sub', name: 'go', params: [{ name: 'a', type: 'int', varargs: false }] })] });
    const subFile = jFile('src/Sub.java', [sub]);
    const td = typeDiff({ status: 'modified', oldType: jType({ fqn: P, members: [oldM] }), newType: baseNew, file: 'src/Base.java', oldFile: file, newFile: file, members: [memberDiff({ status: 'signatureChanged', oldMember: oldM, newMember: newM, flags: ['params'] })] });
    const index = new FakeRepoIndex({
      files: [file, subFile],
      subTypes: { [P]: ['com.acme.Sub'] },
      overrides: { [newM.id]: ['com.acme.Api#go()'] },
      callers: { [newM.id]: [call('com.acme.X#a()', 'src/Base.java', 12)], 'com.acme.Api#go()': [call('com.acme.Y#b()', 'src/Y.java', 3)] },
      callsTo: { [`${P}#go/1`]: [call('com.acme.Z#c()', 'src/Base.java', 20)] },
    });
    const af: AnalyzedFile = { file: fc('src/Base.java', 'service'), cs: { path: 'src/Base.java', status: 'modified', binary: false, additions: 1, deletions: 1, hunks: [] }, typeDiffs: [td], addedLines: new Set([12]), removedLines: new Set(), unanalyzed: false };
    const ctx = ctxFor([af], index);
    registerSymbols(ctx);
    enrich(ctx);
    const mc = td.members[0].change;
    expect(mc.callers.map((c) => [c.fromId, c.inChangedCode, c.confidence])).toEqual([
      ['com.acme.X#a()', true, 'exact'],
      ['com.acme.Y#b()', false, 'likely'],
    ]);
    expect(td.change.subTypes).toEqual(['com.acme.Sub']);
    expect(ctx.staleCalls.get(mc.id)?.map((c) => c.fromId)).toEqual(['com.acme.Z#c()']);
    expect(ctx.brokenOverrides.get(mc.id)).toEqual(['com.acme.Sub#go(int)']);
  });
});

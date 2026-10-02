/**
 * Tur 3 (QA tur 1 bulguları) birim testleri: sahte indeksle bayat çağrı (B1/B2), çift FQN id'leri (B3), import hedefi (B5),
 * risk gürültüsü (B8/B10), override kopması (B11), gruplama (B14) ve küçük maddeler.
 */
import { describe, expect, it } from 'vitest';
import type { CallRef, FileChange, Layer, RiskInfo } from '../../shared/types.js';
import type { CallSite, JavaFileModel, JavaMember, JavaType, TypeDiff } from '../java/model.js';
import { jFile, jMember, jType, memberDiff, typeDiff } from '../testing/builders.js';
import { FakeRepoIndex, type FakeRepoIndexInit } from '../testing/fakeRepoIndex.js';
import { checkArchitecture } from './architecture.js';
import type { AnalysisContext, AnalyzedFile } from './context.js';
import { importRetargets, isCosmeticJava } from './cosmetic.js';
import { enrich, registerSymbols } from './enrich.js';
import { memberFindings, unverifiedStaleFinding } from './findings.js';
import { buildGroups, MAX_GROUP_SYMBOLS } from './grouping.js';
import { isTestPath } from './layers.js';
import { buildReviewPlan } from './reviewPlan.js';
import { RISK_WEIGHTS, scoreMember, scoreNonJavaFile, type MemberRiskInput } from './risk.js';
import { assignUniqueIds, identitySymbolIds, sourceRootFor, stripRootSuffix } from './symbolIds.js';
import { emptyRisk, makeRisk, symbolLabel } from './util.js';

type CallSiteInit = Partial<CallSite> & Pick<CallSite, 'name' | 'line'>;

const site = (init: CallSiteInit): CallSite => ({
  argCount: init.args?.length ?? 0,
  receiverKind: 'identifier',
  isConstructor: false,
  isMethodRef: false,
  ...init,
});

const call = (fromId: string, file: string, line: number, confidence: CallRef['confidence'] = 'exact'): CallRef => ({ fromId, file, line, inChangedCode: false, confidence });

function fc(path: string, layer: Layer = 'service', extra: Partial<FileChange> = {}): FileChange {
  return {
    id: path, path, status: 'modified', language: 'java', binary: false, additions: 1, deletions: 1, hunks: [], layer, isTest: false,
    cosmeticOnly: false, typeIds: [], relatedTestFiles: [], risk: emptyRisk(), reviewOrder: 0, ...extra,
  };
}

function analyzed(path: string, tds: TypeDiff[]): AnalyzedFile {
  return { file: fc(path), cs: { path, status: 'modified', binary: false, additions: 1, deletions: 1, hunks: [] }, typeDiffs: tds, addedLines: new Set(), removedLines: new Set(), unanalyzed: false };
}

function ctxFor(af: AnalyzedFile[], index: FakeRepoIndex): AnalysisContext {
  return {
    files: af, byPath: new Map(af.map((x) => [x.file.path, x])), typeDiffs: af.flatMap((x) => x.typeDiffs), index, hexagonal: false,
    repoFiles: [], repoFilesKnown: true, members: new Map(), types: new Map(), staleCalls: new Map(), unverifiedStaleCalls: new Map(),
    brokenOverrides: new Map(), orphanedOverrides: new Map(), staleTypeRefs: new Map(), architecture: new Map(), importRetargets: new Map(),
    ids: identitySymbolIds(), warnings: [],
  };
}

function run(af: AnalyzedFile[], init: FakeRepoIndexInit): AnalysisContext {
  const ctx = ctxFor(af, new FakeRepoIndex(init));
  registerSymbols(ctx);
  enrich(ctx);
  return ctx;
}

function riskInput(over: Partial<MemberRiskInput> & Pick<MemberRiskInput, 'md'>): MemberRiskInput {
  return { ownerKind: 'class', ownerVisibility: 'public', implementationCount: 0, outsideCallers: 0, staleCalls: [], brokenOverrides: [], isTest: false, ...over };
}

/** Silinen `com.acme.Svc#run()` + head'deki Svc (run yok) + çağıran dosya. */
function removedRunFixture(callerMembers: JavaMember[] = [jMember({ ownerFqn: 'com.acme.C', name: 'go' })], extraTypes: JavaType[] = []) {
  const S = 'com.acme.Svc';
  const oldRun = jMember({ ownerFqn: S, name: 'run' });
  const headSvc = jType({ fqn: S, members: [jMember({ ownerFqn: S, name: 'other' })] });
  const svcFile = jFile('src/com/acme/Svc.java', [headSvc]);
  const callerFile = jFile('src/com/acme/C.java', [jType({ fqn: 'com.acme.C', members: callerMembers }), ...extraTypes]);
  const td = typeDiff({
    status: 'modified', file: svcFile.path, oldType: jType({ fqn: S, members: [oldRun, ...headSvc.members] }), newType: headSvc,
    oldFile: svcFile, newFile: svcFile, members: [memberDiff({ status: 'removed', oldMember: oldRun })],
  });
  return { td, svcFile, callerFile, id: oldRun.id };
}

describe('B1 — bayat çağrı güveni', () => {
  it('name-only çağrı bulgu/risk üretmez; yalnız özet bilgide sayılır', () => {
    const { td, svcFile, callerFile, id } = removedRunFixture();
    const ctx = run([analyzed(svcFile.path, [td])], { files: [svcFile, callerFile], callsTo: { 'com.acme.Svc#run/0': [call('com.acme.C#go()', callerFile.path, 5, 'name-only')] } });
    expect(ctx.staleCalls.has(id)).toBe(false);
    expect(ctx.unverifiedStaleCalls.get(id)).toBe(1);
    const f = unverifiedStaleFinding(ctx.unverifiedStaleCalls);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'info', category: 'callers', title: '1 olası çağrı ad eşleşmesiyle doğrulanamadı' });
  });

  it('exact → error (tam ağırlık); yalnız likely → warning (yarım ağırlık)', () => {
    const m = jMember({ ownerFqn: 'com.acme.Svc', name: 'run' });
    const md = memberDiff({ status: 'removed', oldMember: m });
    const owner = typeDiff({ status: 'modified', oldType: jType({ fqn: 'com.acme.Svc' }), newType: jType({ fqn: 'com.acme.Svc' }), file: 'Svc.java' }).change;
    const exact = scoreMember(riskInput({ md, staleCalls: [call('a.X#x()', 'X.java', 3, 'exact')] }));
    const likely = scoreMember(riskInput({ md, staleCalls: [call('a.X#x()', 'X.java', 3, 'likely')] }));
    const full = RISK_WEIGHTS.removedWithCallers + RISK_WEIGHTS.removedWithCallersPerCall;
    expect(exact.reasons.find((r) => r.code === 'removed-with-callers')?.weight).toBe(full);
    expect(likely.reasons.find((r) => r.code === 'removed-with-callers')?.weight).toBe(Math.round(full / 2));
    const sev = (risk: RiskInfo, calls: CallRef[]) => {
      md.change.risk = risk;
      return memberFindings({ mc: md.change, owner, file: fc('Svc.java'), staleCalls: calls, outsideCallers: 0 }).find((f) => f.id.startsWith('callers:removed-with-callers'))?.severity;
    };
    expect(sev(exact, [call('a.X#x()', 'X.java', 3, 'exact')])).toBe('error');
    expect(sev(likely, [call('a.X#x()', 'X.java', 3, 'likely')])).toBe('warning');
    // name-only risk ve bulgu üretmez
    const nameOnly = scoreMember(riskInput({ md, staleCalls: [call('a.X#x()', 'X.java', 3, 'name-only')] }));
    expect(nameOnly.reasons.map((r) => r.code)).not.toContain('removed-with-callers');
  });

  it('çağrı yeri head\'de var olan başka üyeye bağlıysa (iç sınıfın aynı adlı metodu) bayat değil', () => {
    const inner = jType({ fqn: 'com.acme.C.Inner', outerFqn: 'com.acme.C', members: [jMember({ ownerFqn: 'com.acme.C.Inner', name: 'run' })] });
    const { td, svcFile, callerFile, id } = removedRunFixture([jMember({ ownerFqn: 'com.acme.C', name: 'go' })], [inner]);
    const calls = { 'com.acme.Svc#run/0': [call('com.acme.C#go()', callerFile.path, 5, 'exact'), call('com.acme.C#go()', callerFile.path, 9, 'exact')] };
    const ctx = run([analyzed(svcFile.path, [td])], { files: [svcFile, callerFile], callsTo: calls, callSiteTargets: { 'com.acme.C#go()|5|run': ['com.acme.C.Inner#run()'] } });
    expect(ctx.staleCalls.get(id)?.map((c) => c.line)).toEqual([9]);
  });

  it('açık yapıcısı kalmayan tipte argümansız new X() örtük varsayılan yapıcıya gider', () => {
    const S = 'com.acme.Bag';
    const ctor = jMember({ ownerFqn: S, name: 'Bag', kind: 'constructor' });
    const mk = (headMembers: JavaMember[]) => {
      const head = jType({ fqn: S, members: headMembers });
      const file = jFile('src/com/acme/Bag.java', [head]);
      const td = typeDiff({ status: 'modified', file: file.path, oldType: jType({ fqn: S, members: [ctor] }), newType: head, oldFile: file, newFile: file, members: [memberDiff({ status: 'removed', oldMember: ctor })] });
      const callerFile = jFile('src/com/acme/U.java', [jType({ fqn: 'com.acme.U', members: [jMember({ ownerFqn: 'com.acme.U', name: 'make' })] })]);
      return run([analyzed(file.path, [td])], { files: [file, callerFile], callsTo: { [`${S}#Bag/0`]: [call('com.acme.U#make()', callerFile.path, 4)] } }).staleCalls.get(ctor.id);
    };
    expect(mk([])).toBeUndefined();
    const withArgCtor = jMember({ ownerFqn: S, name: 'Bag', kind: 'constructor', params: [{ name: 'n', type: 'int', varargs: false }] });
    expect(mk([withArgCtor])?.length).toBe(1);
  });

  it('sahip tip silindiyse eski üst tipler head\'de çözülür (Pair.PairAdapter#getLeft → Pair#getLeft)', () => {
    const P = 'com.acme.Pair';
    const A = 'com.acme.Pair.PairAdapter';
    const getLeft = jMember({ ownerFqn: A, name: 'getLeft', visibility: 'public' });
    const oldAdapter = jType({ fqn: A, outerFqn: P, superclass: 'Pair', members: [getLeft] });
    const headPair = jType({ fqn: P, members: [jMember({ ownerFqn: P, name: 'getLeft' })] });
    const file = jFile('src/com/acme/Pair.java', [headPair]);
    const oldFile = jFile('src/com/acme/Pair.java', [headPair, oldAdapter]);
    const td = typeDiff({ status: 'removed', file: file.path, oldType: oldAdapter, oldFile, members: [memberDiff({ status: 'removed', oldMember: getLeft })] });
    const caller = jMember({ ownerFqn: 'com.acme.U', name: 'use', callSites: [site({ name: 'getLeft', line: 3, args: [] })] });
    const callerFile = jFile('src/com/acme/U.java', [jType({ fqn: 'com.acme.U', members: [caller] })]);
    const ctx = run([analyzed(file.path, [td])], { files: [file, callerFile], callsTo: { [`${A}#getLeft/0`]: [call(caller.id, callerFile.path, 3)] } });
    expect(ctx.staleCalls.get(getLeft.id)).toBeUndefined();
  });
});

describe('B1 — silinen iç tip, aynı adlı JDK tipi', () => {
  it('java.util.Iterator üzerinden çağrı silinen DynamicHasher.Iterator#hasNext için bayat sayılmaz; tipi gören dosyadaki çağrı sayılır', () => {
    const OUT = 'p.hasher.DynamicHasher';
    const IT = `${OUT}.Iterator`;
    const hasNext = jMember({ ownerFqn: IT, name: 'hasNext', returnType: 'boolean' });
    const oldIt = jType({ fqn: IT, outerFqn: OUT, members: [hasNext] });
    const headOuter = jType({ fqn: OUT });
    const file = jFile('src/p/hasher/DynamicHasher.java', [headOuter]);
    const td = typeDiff({ status: 'removed', file: file.path, oldType: oldIt, oldFile: jFile(file.path, [headOuter, oldIt]), members: [memberDiff({ status: 'removed', oldMember: hasNext })] });
    const jdkUser = jFile('src/p/map/MapTest.java', [jType({ fqn: 'p.map.MapTest', members: [jMember({ ownerFqn: 'p.map.MapTest', name: 't' })] })], { imports: ['java.util.Iterator'] });
    jdkUser.typeRefs = ['Iterator', 'MapTest'];
    const realUser = jFile('src/p/hasher/Use.java', [jType({ fqn: 'p.hasher.Use', members: [jMember({ ownerFqn: 'p.hasher.Use', name: 'u' })] })]);
    realUser.typeRefs = ['DynamicHasher', 'Iterator', 'Use'];
    const calls = [call('p.map.MapTest#t()', jdkUser.path, 7), call('p.hasher.Use#u()', realUser.path, 4)];
    const ctx = run([analyzed(file.path, [td])], { files: [file, jdkUser, realUser], callsTo: { [`${IT}#hasNext/0`]: calls } });
    expect(ctx.staleCalls.get(hasNext.id)?.map((c) => c.file)).toEqual([realUser.path]);
  });
});

describe('B2 — aynı arity\'de kalan overload', () => {
  const U = 'com.acme.CharSequenceUtils';
  const p = (type: string, name = 'x') => ({ name, type, varargs: false });
  const oldM = jMember({ ownerFqn: U, name: 'indexOf', modifiers: ['static'], params: [p('CharSequence', 'cs'), p('int', 'searchChar'), p('int', 'start')] });
  const newM = jMember({ ownerFqn: U, name: 'indexOf', modifiers: ['static'], params: [p('CharSequence', 'cs'), p('int', 'searchChar'), p('int', 'start'), p('int', 'end')] });
  const other = jMember({ ownerFqn: U, name: 'indexOf', modifiers: ['static'], params: [p('CharSequence', 'cs'), p('CharSequence', 'searchSeq'), p('int', 'start')] });
  const head = jType({ fqn: U, members: [newM, other] });
  const file = jFile('src/com/acme/CharSequenceUtils.java', [head]);
  const td = typeDiff({ status: 'modified', file: file.path, oldType: jType({ fqn: U, members: [oldM, other] }), newType: head, oldFile: file, newFile: file, members: [memberDiff({ status: 'signatureChanged', oldMember: oldM, newMember: newM, flags: ['params'] })] });
  const caller = jMember({
    ownerFqn: 'com.acme.StringUtils', name: 'find', localTypes: { seq: 'CharSequence', sub: 'CharSequence', unknown: 'T' },
    callSites: [
      site({ name: 'indexOf', line: 10, args: ['seq', "'c'", '0'], receiver: 'CharSequenceUtils' }),
      site({ name: 'indexOf', line: 11, args: ['seq', 'sub', '0'], receiver: 'CharSequenceUtils' }),
      site({ name: 'indexOf', line: 12, args: ['seq', 'compute()', '0'], receiver: 'CharSequenceUtils' }),
    ],
  });
  const callerFile = jFile('src/com/acme/StringUtils.java', [jType({ fqn: 'com.acme.StringUtils', members: [caller] })]);

  it('argüman tipleri kalan overload\'a uymayan çağrı likely bayat; uyan ve çıkarılamayan sessiz', () => {
    const calls = [10, 11, 12].map((l) => call(caller.id, callerFile.path, l));
    const ctx = run([analyzed(file.path, [td])], { files: [file, callerFile], callsTo: { [`${U}#indexOf/3`]: calls } });
    const stale = ctx.staleCalls.get(newM.id) ?? [];
    expect(stale.map((c) => [c.line, c.confidence])).toEqual([[10, 'likely']]);
  });
});

describe('B3 — çift FQN', () => {
  const mk = (root: string) => {
    const fqn = 'com.google.common.base.Preconditions';
    const o = jMember({ ownerFqn: fqn, name: 'checkNotNull', params: [{ name: 'r', type: 'T', varargs: false }] });
    const n = { ...o, text: 'public T checkNotNull(T r) { return r; }' };
    const t = jType({ fqn, members: [n] });
    const f = jFile(`${root}/com/google/common/base/Preconditions.java`, [t]);
    return typeDiff({ status: 'modified', file: f.path, oldType: t, newType: t, oldFile: f, newFile: f, members: [memberDiff({ status: 'modified', oldMember: o, newMember: n, flags: ['body'] })] });
  };

  it('yalnız çakışmada \'@kök\' soneki; toIndex/toModel dönüşümü', () => {
    const a = mk('guava/src');
    const b = mk('android/guava/src');
    const single = mk('x/src');
    single.change.id = 'com.acme.Single';
    const ids = assignUniqueIds([a, b, single], (p) => (p.startsWith('android/') ? 'android/guava/src' : p.startsWith('guava/') ? 'guava/src' : undefined));
    expect(a.change.id).toBe('com.google.common.base.Preconditions@guava/src');
    expect(b.change.id).toBe('com.google.common.base.Preconditions@android/guava/src');
    expect(b.members[0].change.id).toBe('com.google.common.base.Preconditions@android/guava/src#checkNotNull(T)');
    expect(b.members[0].change.ownerTypeId).toBe(b.change.id);
    expect(single.change.id).toBe('com.acme.Single');
    expect(ids.toIndex(b.members[0].change.id)).toBe('com.google.common.base.Preconditions#checkNotNull(T)');
    expect(ids.toModel('com.google.common.base.Preconditions#checkNotNull(T)', 'android/guava/src/com/google/common/base/Other.java')).toBe(b.members[0].change.id);
    expect(ids.toModel('com.google.common.base.Preconditions#checkNotNull(T)', 'futures/src/X.java')).toBe('com.google.common.base.Preconditions#checkNotNull(T)');
    expect(symbolLabel(b.members[0].change.id)).toBe('Preconditions.checkNotNull');
    expect(stripRootSuffix('a.B@x/y#m()')).toBe('a.B#m()');
    expect(sourceRootFor('android/guava/src/com/google/common/base/X.java', 'com.google.common.base')).toBe('android/guava/src');
    expect(sourceRootFor('X.java', '')).toBe('.');
  });

  it('aynı kökte (tespit edilmemiş taşıma) sonek eklenmez', () => {
    const a = mk('src');
    const b = mk('src');
    assignUniqueIds([a, b], () => 'src');
    expect(a.change.id).toBe('com.google.common.base.Preconditions');
  });
});

describe('B5 — import hedefi', () => {
  const entity = (imp: string, code = 'public class Owner { @Entity Object x; }') =>
    jFile('src/main/java/p/Owner.java', [jType({ fqn: 'p.Owner', normalizedText: code })], { imports: [imp, 'java.util.List'], normalizedCode: code });

  it('javax → jakarta kozmetik değil; yalnız sıralama/kullanılmayan import kozmetik', () => {
    const o = entity('javax.persistence.Entity');
    const n = entity('jakarta.persistence.Entity');
    const t = jType({ fqn: 'p.Owner' });
    const td = typeDiff({ status: 'unchanged', oldType: t, newType: t, file: o.path });
    expect(importRetargets(o, n)).toEqual([{ name: 'Entity', from: 'javax.persistence.Entity', to: 'jakarta.persistence.Entity' }]);
    expect(isCosmeticJava('modified', o, n, [td])).toBe(false);
    // kullanılmayan import
    const unusedO = entity('javax.annotation.Nullable', 'public class Owner { }');
    const unusedN = entity('jakarta.annotation.Nullable', 'public class Owner { }');
    expect(importRetargets(unusedO, unusedN)).toEqual([]);
    expect(isCosmeticJava('modified', unusedO, unusedN, [td])).toBe(true);
    // yeniden sıralama
    const re = jFile(o.path, o.types, { imports: ['java.util.List', 'javax.persistence.Entity'], normalizedCode: o.normalizedCode });
    expect(isCosmeticJava('modified', o, re, [td])).toBe(true);
    // wildcard paket değişimi
    const wo = jFile(o.path, o.types, { imports: ['javax.persistence.*'], normalizedCode: o.normalizedCode });
    const wn = jFile(o.path, o.types, { imports: ['jakarta.persistence.*'], normalizedCode: o.normalizedCode });
    expect(importRetargets(wo, wn)).toEqual([{ name: '*', from: 'javax.persistence.*', to: 'jakarta.persistence.*' }]);
  });
});

describe('B8/B10 — risk gürültüsü', () => {
  const m = jMember({ ownerFqn: 'com.acme.Calc', name: 'calc' });
  const body = (text: string) => ({ ...m, text });
  const md = memberDiff({ status: 'modified', oldMember: body('void calc() { a(); }'), newMember: body('void calc() { b(); }'), flags: ['body'] });

  it('diff dışı çağıran ağırlığı: exact tam, likely yarım + tavan, name-only sıfır', () => {
    const exact = scoreMember(riskInput({ md, outsideCallers: 4 }));
    expect(exact.reasons.find((r) => r.code === 'callers-outside-diff')?.weight).toBe(RISK_WEIGHTS.callersOutside + 4 * RISK_WEIGHTS.callersOutsidePer);
    const likely = scoreMember(riskInput({ md, outsideCallers: 0, outsideLikelyCallers: 50 }));
    expect(likely.reasons.find((r) => r.code === 'callers-outside-diff')?.weight).toBe(RISK_WEIGHTS.callersOutsideLikelyCap);
    expect(likely.level).toBe('low');
    const none = scoreMember(riskInput({ md, outsideCallers: 0, outsideLikelyCallers: 0 }));
    expect(none.reasons.map((r) => r.code)).not.toContain('callers-outside-diff');
  });

  it('gövde değişikliği + çok sayıda çağıran tek başına high üretmez', () => {
    const r = scoreMember(riskInput({ md, outsideCallers: 30 }));
    expect(r.score).toBeLessThan(45);
    expect(r.level).toBe('medium');
  });

  it('equals/hashCode aynı alanlarla yeniden yazımda tutarsızlık bulgusu yok; alan kümesi değişince var', () => {
    const O = 'com.acme.ConstantInitializer';
    const hc = (text: string) => jMember({ ownerFqn: O, name: 'hashCode', returnType: 'int', text });
    const owner = jType({ fqn: O, fieldTypes: { object: 'Object', other: 'int' }, members: [hc('x'), jMember({ ownerFqn: O, name: 'equals', params: [{ name: 'o', type: 'Object', varargs: false }] })] });
    const rewrite = memberDiff({ status: 'modified', oldMember: hc('public int hashCode() { return object == null ? 0 : object.hashCode(); }'), newMember: hc('public int hashCode() { return Objects.hashCode(object); }'), flags: ['body'] });
    const r1 = scoreMember(riskInput({ md: rewrite, ownerType: owner, changedSiblingNames: new Set(['hashCode']) }));
    expect(r1.reasons.map((r) => r.code)).not.toContain('equals-hashcode-mismatch');
    expect(r1.reasons.find((r) => r.code === 'equality-contract')?.weight).toBe(RISK_WEIGHTS.equalityRewrite);
    const changed = memberDiff({ status: 'modified', oldMember: hc('public int hashCode() { return Objects.hashCode(object); }'), newMember: hc('public int hashCode() { return Objects.hash(object, other); }'), flags: ['body'] });
    const r2 = scoreMember(riskInput({ md: changed, ownerType: owner, changedSiblingNames: new Set(['hashCode']) }));
    expect(r2.reasons.map((r) => r.code)).toContain('equals-hashcode-mismatch');
    // Erişimci (getObject()) alanın kendisi sayılır: getObject() → object yeniden yazımı anlamlı değil
    const viaGetter = memberDiff({ status: 'modified', oldMember: hc('public int hashCode() { return getObject() != null ? getObject().hashCode() : 0; }'), newMember: hc('public int hashCode() { return Objects.hashCode(object); }'), flags: ['body'] });
    expect(scoreMember(riskInput({ md: viaGetter, ownerType: owner, changedSiblingNames: new Set(['hashCode']) })).reasons.map((r) => r.code)).not.toContain('equals-hashcode-mismatch');
  });

  it('statik equals(a, b) yardımcı metodu eşitlik sözleşmesi sayılmaz', () => {
    const U = 'com.acme.ObjectUtils';
    const p = (n: string) => ({ name: n, type: 'Object', varargs: false });
    const m = (text: string) => jMember({ ownerFqn: U, name: 'equals', modifiers: ['public', 'static'], params: [p('a'), p('b')], returnType: 'boolean', text });
    const md = memberDiff({ status: 'modified', oldMember: m('static boolean equals(Object a, Object b) { return a == b; }'), newMember: m('static boolean equals(Object a, Object b) { return Objects.equals(a, b); }'), flags: ['body'] });
    expect(scoreMember(riskInput({ md })).reasons.map((r) => r.code)).not.toContain('equality-contract');
  });

  it('yeni tipte / soyut sınıfta implementasyon 0 ise sözleşme kuralı sessiz', () => {
    const am = jMember({ ownerFqn: 'com.acme.Op', name: 'apply', modifiers: ['public', 'abstract'] });
    const added = memberDiff({ status: 'added', newMember: am });
    expect(scoreMember(riskInput({ md: added, ownerKind: 'enum', implementationCount: 0 })).reasons.map((r) => r.code)).not.toContain('interface-contract');
    expect(scoreMember(riskInput({ md: added, ownerKind: 'interface', implementationCount: 0, ownerAdded: true })).reasons.map((r) => r.code)).not.toContain('interface-contract');
    const msgs = scoreMember(riskInput({ md: added, ownerKind: 'class', implementationCount: 0 })).reasons.map((r) => r.message).join(' ');
    expect(msgs).not.toMatch(/0 implementasyon/);
  });
});

describe('B11 — override kopması', () => {
  const B = 'com.acme.Base';
  const oldM = jMember({ ownerFqn: B, name: 'go', params: [{ name: 'a', type: 'int', varargs: false }] });
  const headBase = jType({ fqn: B, members: [] });
  const baseFile = jFile('src/com/acme/Base.java', [headBase]);
  const td = () => typeDiff({ status: 'modified', file: baseFile.path, oldType: jType({ fqn: B, members: [oldM] }), newType: headBase, oldFile: baseFile, newFile: baseFile, members: [memberDiff({ status: 'removed', oldMember: oldM })] });
  const sub = (fqn: string, annotations: string[], extra: Partial<JavaType> = {}) =>
    jType({ fqn, superclass: 'Base', members: [jMember({ ownerFqn: fqn, name: 'go', annotations, params: [{ name: 'a', type: 'int', varargs: false }] })], ...extra });

  it('@Override + hiçbir şeyi override etmiyor → kırık; @Override yok → bilgi; hâlâ override ediyor → yok', () => {
    const s1 = sub('com.acme.S1', ['@Override']);
    const s2 = sub('com.acme.S2', []);
    const s3 = sub('com.acme.S3', ['@Override'], { interfaces: ['Api'] });
    const api = jType({ fqn: 'com.acme.Api', kind: 'interface', members: [jMember({ ownerFqn: 'com.acme.Api', name: 'go', params: [{ name: 'a', type: 'int', varargs: false }] })] });
    const files = [baseFile, jFile('src/com/acme/S1.java', [s1]), jFile('src/com/acme/S2.java', [s2]), jFile('src/com/acme/S3.java', [s3]), jFile('src/com/acme/Api.java', [api])];
    const t = td();
    const ctx = run([analyzed(baseFile.path, [t])], { files, subTypes: { [B]: ['com.acme.S1', 'com.acme.S2', 'com.acme.S3'] }, overrides: { 'com.acme.S3#go(int)': ['com.acme.Api#go(int)'] } });
    expect(ctx.brokenOverrides.get(oldM.id)).toEqual(['com.acme.S1#go(int)']);
    expect(ctx.orphanedOverrides.get(oldM.id)).toEqual(['com.acme.S2#go(int)']);
    const r = scoreMember(riskInput({ md: t.members[0], brokenOverrides: [], orphanedOverrides: ['com.acme.S2#go(int)'] }));
    expect(r.reasons.find((x) => x.code === 'override-orphaned')?.weight).toBe(0);
  });

  it('anonim sınıf sentetik id\'leri ($anon) overriddenBy\'da çökmeden korunur', () => {
    const P = 'com.acme.Listener';
    const m = jMember({ ownerFqn: P, name: 'on', text: 'void on() { a(); }' });
    const n = { ...m, text: 'void on() { b(); }' };
    const t = jType({ fqn: P, members: [n] });
    const f = jFile('src/com/acme/Listener.java', [t]);
    const td = typeDiff({ status: 'modified', file: f.path, oldType: t, newType: t, oldFile: f, newFile: f, members: [memberDiff({ status: 'modified', oldMember: m, newMember: n, flags: ['body'] })] });
    const anon = 'com.acme.Use#go()$anon1#on()';
    const ctx = run([analyzed(f.path, [td])], { files: [f], overriddenBy: { [n.id]: [anon] } });
    expect(td.members[0].change.overriddenBy).toEqual([anon]);
    expect(ctx.warnings).toEqual([]);
  });

  it('repo dışı üst tipi olan alt sınıfta emin olunamaz: sessiz', () => {
    const s = sub('com.acme.S4', ['@Override'], { interfaces: ['java.util.function.IntConsumer'] });
    const ctx = run([analyzed(baseFile.path, [td()])], { files: [baseFile, jFile('src/com/acme/S4.java', [s])], subTypes: { [B]: ['com.acme.S4'] } });
    expect(ctx.brokenOverrides.size + ctx.orphanedOverrides.size).toBe(0);
  });
});

describe('B14 — gruplama', () => {
  const sym = (owner: string, name: string, status: 'modified' | 'signatureChanged' = 'modified') => {
    const m = jMember({ ownerFqn: owner, name, params: status === 'signatureChanged' ? [{ name: 'x', type: 'int', varargs: false }] : [] });
    return memberDiff({ status, oldMember: m, newMember: m, flags: status === 'signatureChanged' ? ['params'] : ['body'] });
  };
  const tdOf = (fqn: string, mds: ReturnType<typeof sym>[], pkg = 'com.acme') => {
    const t = jType({ fqn, members: mds.map((x) => x.newMember as JavaMember) });
    const f = jFile(`src/${pkg.replace(/\./g, '/')}/${fqn.split('.').pop()}.java`, [t], { packageName: pkg });
    const td = typeDiff({ status: 'modified', file: f.path, oldType: t, newType: t, oldFile: f, newFile: f, members: mds });
    for (const md of mds) md.change.risk = makeRisk([{ code: 'x', message: 'x', weight: 50 }]);
    return td;
  };

  it('equals gibi hub sembol farklı tipleri birleştirmez', () => {
    const eq = sym('com.acme.Shape', 'equals', 'signatureChanged');
    const a = sym('com.acme.A', 'a');
    const b = sym('com.acme.B', 'b');
    a.change.callees = [eq.change.id];
    b.change.callees = [eq.change.id];
    const tds = [tdOf('com.acme.Shape', [eq]), tdOf('com.acme.A', [a]), tdOf('com.acme.B', [b])];
    const groups = buildGroups(tds, tds.map((t) => fc(t.change.file)));
    expect(groups.find((g) => g.symbolIds.includes(a.change.id))?.symbolIds).not.toContain(b.change.id);
  });

  it(`${MAX_GROUP_SYMBOLS} sembolü aşan bileşen paket bazında bölünür ve başlıkta belirtilir`, () => {
    const api = sym('com.acme.api.Api', 'run', 'signatureChanged');
    const tds: TypeDiff[] = [tdOf('com.acme.api.Api', [api], 'com.acme.api')];
    for (const pkg of ['com.acme.x', 'com.acme.y']) {
      for (let i = 0; i < 30; i++) {
        const fqn = `${pkg}.T${i}`;
        const m = sym(fqn, 'run');
        m.change.overrides = [api.change.id];
        tds.push(tdOf(fqn, [m], pkg));
      }
    }
    const groups = buildGroups(tds, tds.map((t) => fc(t.change.file)));
    const big = groups.filter((g) => g.title.includes('paket '));
    expect(big.length).toBeGreaterThanOrEqual(2);
    for (const g of groups) expect(g.symbolIds.length).toBeLessThanOrEqual(MAX_GROUP_SYMBOLS);
    expect(big.some((g) => g.title.includes('paket com.acme.x'))).toBe(true);
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
  });

  it('sınırı tek başına aşan tipin üyeleri de dilimlenir; tüm semboller bir gruba düşer', () => {
    const mds = Array.from({ length: 95 }, (_, i) => sym('com.acme.StringUtils', `m${i}`));
    const tds = [tdOf('com.acme.StringUtils', mds)];
    const groups = buildGroups(tds, tds.map((t) => fc(t.change.file)));
    const parts = groups.filter((g) => g.title.includes('bölüm'));
    expect(parts.map((g) => g.symbolIds.length)).toEqual([40, 40, 15]);
    expect(parts[0].title).toMatch(/paket com\.acme, bölüm 1\/3$/);
    expect(new Set(groups.flatMap((g) => g.symbolIds)).size).toBe(95);
  });
});

describe('küçük maddeler', () => {
  it('module-info requires/exports orta risk; package-info düşük; plan gerekçesi', () => {
    const hunk = (text: string) => [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '', lines: [{ type: 'add' as const, newNo: 1, text }] }];
    const mod = fc('src/main/java/module-info.java', 'other', { hunks: hunk('  requires java.sql;') });
    mod.risk = scoreNonJavaFile(mod);
    expect(mod.risk.level).toBe('medium');
    expect(mod.risk.reasons[0].code).toBe('module-descriptor');
    const pkg = fc('src/main/java/com/acme/package-info.java', 'other', { hunks: hunk('@NullMarked') });
    pkg.risk = scoreNonJavaFile(pkg);
    expect(pkg.risk.level).toBe('low');
    const plan = buildReviewPlan([mod, pkg], new Map());
    expect(plan.map((s) => s.reason).every((r) => r.startsWith('Paket/modül bildirimi'))).toBe(true);
  });

  it('plan test bağlama: önek eşleşmesi; belirsiz çoklu adayda uydurma bağlama yok', () => {
    const prod = (name: string) => {
      const t = jType({ fqn: `p.${name}` });
      const path = `src/main/java/p/${name}.java`;
      const f = fc(path, 'other', { relatedTestFiles: ['src/test/java/p/BitMapExtractorFromLongArrayTest.java', 'src/test/java/p/MixedTest.java'] });
      return { f, td: typeDiff({ status: 'added', newType: t, file: path }) };
    };
    const testFile = (name: string, code: string) => {
      const path = `src/test/java/p/${name}.java`;
      const t = jType({ fqn: `p.${name}` });
      const model: JavaFileModel = jFile(path, [t], { normalizedCode: code });
      return { f: fc(path, 'test', { isTest: true }), td: typeDiff({ status: 'added', newType: t, newFile: model, file: path }) };
    };
    const a = prod('BitMapExtractor');
    const b = prod('IndexExtractor');
    const t1 = testFile('BitMapExtractorFromLongArrayTest', 'IndexExtractor x; IndexExtractor y;');
    const t2 = testFile('MixedTest', 'BitMapExtractor a; IndexExtractor b;');
    const files = [a.f, b.f, t1.f, t2.f];
    const plan = buildReviewPlan(files, new Map([a, b, t1, t2].map((x) => [x.f.path, [x.td]])));
    const order = plan.map((s) => s.fileId);
    expect(order.indexOf(t1.f.path)).toBe(order.indexOf(a.f.path) + 1);
    expect(plan.find((s) => s.fileId === t2.f.path)?.reason).not.toMatch(/doğrulayan test/);
  });

  it('test katmanı: testlib, testFixtures, src/test*, *Tester, *TestCase', () => {
    for (const p of ['guava-testlib/src/com/google/common/testing/EqualsTester.java', 'lib/testlib/X.java', 'src/testFixtures/java/X.java', 'src/testIntegration/java/X.java', 'core/src/main/java/a/MapTester.java', 'src/main/java/a/AbstractTestCase.java']) {
      expect(isTestPath(p), p).toBe(true);
    }
    expect(isTestPath('src/main/java/a/Testimony.java')).toBe(false);
    expect(isTestPath('src/main/java/a/Contest.java')).toBe(false);
  });

  it('Spring Data arayüzünde @Transactional(readOnly = true) bilgi; diğer @Transactional uyarı', () => {
    const R = 'com.acme.OwnerRepository';
    const m = (name: string, ann: string) => jMember({ ownerFqn: R, name, annotations: [ann] });
    const t = jType({ fqn: R, kind: 'interface', interfaces: ['JpaRepository'], members: [m('findAll', '@Transactional(readOnly = true)'), m('save', '@Transactional')] });
    const f = jFile('src/main/java/com/acme/OwnerRepository.java', [t]);
    const out = checkArchitecture(f.path, f, undefined, undefined, { hexagonal: false, resolve: () => undefined, getType: () => undefined });
    expect(out.find((x) => x.symbolIds?.[0] === `${R}#findAll()`)?.severity).toBe('info');
    expect(out.find((x) => x.symbolIds?.[0] === `${R}#save()`)?.severity).toBe('warning');
  });
});

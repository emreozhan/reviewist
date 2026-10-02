import { describe, expect, it } from 'vitest';
import type { CallRef, FileChange } from '../../shared/types.js';
import { jMember, jType, memberDiff, typeDiff } from '../testing/builders.js';
import { RISK_WEIGHTS, isBreakingSignature, scoreJavaFile, scoreMember, scoreNonJavaFile, scoreType, semanticAnnotationChanges, type MemberRiskInput } from './risk.js';
import { riskLevel } from './util.js';

const OWNER = 'com.acme.OrderService';

function input(over: Partial<MemberRiskInput> & Pick<MemberRiskInput, 'md'>): MemberRiskInput {
  return {
    ownerKind: 'class',
    ownerVisibility: 'public',
    implementationCount: 0,
    outsideCallers: 0,
    staleCalls: [],
    brokenOverrides: [],
    isTest: false,
    ...over,
  };
}

const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);
const call = (fromId: string, line = 10): CallRef => ({ fromId, file: 'src/main/java/com/acme/X.java', line, inChangedCode: false, confidence: 'exact' });

describe('riskLevel', () => {
  it('eşikler', () => {
    expect(riskLevel(0)).toBe('low');
    expect(riskLevel(19)).toBe('low');
    expect(riskLevel(20)).toBe('medium');
    expect(riskLevel(45)).toBe('high');
    expect(riskLevel(70)).toBe('critical');
  });
});

describe('scoreMember', () => {
  it('kozmetik ve değişmemiş: 0', () => {
    const m = jMember({ ownerFqn: OWNER, name: 'a' });
    expect(scoreMember(input({ md: memberDiff({ status: 'cosmetic', oldMember: m, newMember: m }) })).score).toBe(0);
    expect(scoreMember(input({ md: memberDiff({ status: 'unchanged', oldMember: m, newMember: m }) })).reasons).toEqual([]);
  });

  it('public imza değişikliği ve silinmiş-ama-çağrılan kritik', () => {
    const o = jMember({ ownerFqn: OWNER, name: 'place', params: [{ name: 'a', type: 'int', varargs: false }] });
    const n = jMember({ ownerFqn: OWNER, name: 'place', params: [{ name: 'a', type: 'int', varargs: false }, { name: 'b', type: 'int', varargs: false }] });
    const r = scoreMember(input({ md: memberDiff({ status: 'signatureChanged', oldMember: o, newMember: n, flags: ['params'] }), staleCalls: [call('com.acme.A#x()')] }));
    expect(codes(r)).toEqual(expect.arrayContaining(['public-api-signature', 'removed-with-callers']));
    expect(r.level).toBe('critical');
    expect(r.reasons.find((x) => x.code === 'removed-with-callers')?.message).toContain('X.java:10');
  });

  it('yalnızca anotasyon farkıyla gelen signatureChanged kırıcı sayılmaz', () => {
    const o = jMember({ ownerFqn: OWNER, name: 'cancel', text: 'public void cancel() {}' });
    const n = jMember({ ownerFqn: OWNER, name: 'cancel', annotations: ['@Transactional'], text: '@Transactional public void cancel() {}' });
    const md = memberDiff({ status: 'signatureChanged', oldMember: o, newMember: n, flags: ['annotations'] });
    expect(isBreakingSignature(md.change)).toBe(false);
    const r = scoreMember(input({ md }));
    expect(codes(r)).not.toContain('public-api-signature');
    expect(codes(r)).toContain('annotation-transaction');
    expect(r.level).toBe('medium');
  });

  it('private silme düşük, public silme orta', () => {
    const priv = jMember({ ownerFqn: OWNER, name: 'p', visibility: 'private' });
    const pub = jMember({ ownerFqn: OWNER, name: 'q' });
    expect(scoreMember(input({ md: memberDiff({ status: 'removed', oldMember: priv }) })).level).toBe('low');
    expect(scoreMember(input({ md: memberDiff({ status: 'removed', oldMember: pub }) })).level).toBe('medium');
  });

  it('arayüze soyut metot eklenmesi implementasyon sayısıyla artar', () => {
    const m = jMember({ ownerFqn: 'com.acme.Port', name: 'run' });
    const md = memberDiff({ status: 'added', newMember: m });
    const two = scoreMember(input({ md, ownerKind: 'interface', implementationCount: 2 }));
    const five = scoreMember(input({ md, ownerKind: 'interface', implementationCount: 5 }));
    expect(codes(two)).toContain('interface-contract');
    expect(five.score).toBeGreaterThan(two.score);
    const none = scoreMember(input({ md, ownerKind: 'interface', implementationCount: 0 }));
    expect(none.reasons.find((r) => r.code === 'interface-contract')?.weight).toBe(5);
  });

  it('override edilen metot ve template method', () => {
    const o = jMember({ ownerFqn: 'com.acme.Base', name: 'send', text: 'public final void send() { format(); }' });
    const n = jMember({
      ownerFqn: 'com.acme.Base',
      name: 'send',
      text: 'public final void send() { if (x) return; format(); }',
      callSites: [{ name: 'format', argCount: 0, receiverKind: 'none', line: 3, isConstructor: false, isMethodRef: false }],
    });
    const md = memberDiff({ status: 'modified', oldMember: o, newMember: n, flags: ['body'] });
    const r = scoreMember(input({ md, implementationCount: 3, hookNames: new Set(['format']) }));
    expect(codes(r)).toContain('template-method');
    expect(r.reasons.find((x) => x.code === 'template-method')?.message).toContain('3 alt tip');

    md.change.overriddenBy = ['com.acme.Sub#send()'];
    expect(codes(scoreMember(input({ md })))).toContain('overridden-behavior');
  });

  it('diff dışı çağıranlar', () => {
    const m = jMember({ ownerFqn: OWNER, name: 'calc' });
    const r = scoreMember(input({ md: memberDiff({ status: 'modified', oldMember: m, newMember: m, flags: ['body'] }), outsideCallers: 4 }));
    expect(r.reasons.find((x) => x.code === 'callers-outside-diff')?.weight).toBe(RISK_WEIGHTS.callersOutside + 4 * RISK_WEIGHTS.callersOutsidePer);
  });

  it('equals/hashCode, eşzamanlılık, hata yönetimi, SQL, null, karmaşıklık', () => {
    const eqO = jMember({ ownerFqn: OWNER, name: 'equals', params: [{ name: 'o', type: 'Object', varargs: false }], returnType: 'boolean' });
    const eqN = { ...eqO, text: 'public boolean equals(Object o) { return true; }' };
    const owner = jType({ fqn: OWNER, members: [eqO, jMember({ ownerFqn: OWNER, name: 'hashCode', returnType: 'int' })] });
    const eq = scoreMember(input({ md: memberDiff({ status: 'modified', oldMember: eqO, newMember: eqN, flags: ['body'] }), ownerType: owner, changedSiblingNames: new Set(['equals']) }));
    expect(codes(eq)).toEqual(expect.arrayContaining(['equality-contract', 'equals-hashcode-mismatch']));
    expect(eq.level).toBe('high');

    const o = jMember({
      ownerFqn: OWNER,
      name: 'work',
      text: 'void work() { try { a(); } catch (IOException e) { log(e); } if (x != null) {} String q = "SELECT a FROM t"; }',
      features: { catches: 1, nullChecks: 1, sqlStrings: 1 },
      complexity: 2,
    });
    const n = jMember({
      ownerFqn: OWNER,
      name: 'work',
      text: 'synchronized void work() { try { a(); } catch (Exception e) {} e.printStackTrace(); String q = "SELECT b FROM t"; return null; }',
      features: { catches: 1, emptyCatches: 1, printStackTrace: 1, nullChecks: 0, returnsNull: 1, sqlStrings: 1 },
      complexity: 9,
    });
    const r = scoreMember(input({ md: memberDiff({ status: 'modified', oldMember: o, newMember: n, flags: ['body', 'modifiers'], linesAdded: 40, linesRemoved: 20 }) }));
    expect(codes(r)).toEqual(
      expect.arrayContaining(['concurrency', 'empty-catch', 'generic-catch', 'print-stack-trace', 'sql-change', 'null-checks-decreased', 'returns-null', 'complexity', 'large-body']),
    );
    expect(r.score).toBe(100);
  });

  it('static değişebilir alan ve test kodu yarıya', () => {
    const f = jMember({ ownerFqn: OWNER, name: 'CACHE', kind: 'field', modifiers: ['private', 'static'], visibility: 'private', fieldType: 'Map<String,String>' });
    const r = scoreMember(input({ md: memberDiff({ status: 'added', newMember: f }) }));
    expect(codes(r)).toContain('static-mutable');
    const m = jMember({ ownerFqn: OWNER, name: 'q' });
    const prod = scoreMember(input({ md: memberDiff({ status: 'removed', oldMember: m }) }));
    const test = scoreMember(input({ md: memberDiff({ status: 'removed', oldMember: m }), isTest: true }));
    expect(test.score).toBe(Math.round(prod.score / 2));
    expect(codes(test)).toContain('test-code');
  });

  it('mimari ihlal riske katkı verir', () => {
    const f = jMember({ ownerFqn: OWNER, name: 'svc', kind: 'field', visibility: 'private', annotations: ['@Autowired'] });
    const r = scoreMember(input({ md: memberDiff({ status: 'added', newMember: f }), architecture: [{ severity: 'warning', title: '@Autowired alan enjeksiyonu' }] }));
    expect(r.level).toBe('medium');
    expect(codes(r)).toContain('architecture-violation');
  });
});

describe('semanticAnnotationChanges', () => {
  it('argüman değişikliğini ve parametre anotasyonlarını yakalar', () => {
    const ch = semanticAnnotationChanges('@Transactional void a(@Valid Req r)', '@Transactional(readOnly = true) void a(Req r)');
    const keys = ch.map((c) => c.key).sort();
    expect(keys).toEqual(['transaction', 'validation']);
    expect(ch.find((c) => c.key === 'transaction')?.added).toEqual(['@Transactional(readOnly = true)']);
    expect(semanticAnnotationChanges('@Override void a()', '@Override void a()')).toEqual([]);
  });
});

describe('scoreType / dosya', () => {
  it('kalıtım değişikliği ve silinmiş tipe referans', () => {
    const o = jType({ fqn: 'com.acme.A', superclass: 'Base' });
    const n = jType({ fqn: 'com.acme.A', superclass: 'OtherBase' });
    const td = typeDiff({ status: 'modified', oldType: o, newType: n, file: 'A.java' });
    const r = scoreType({ td, memberRisks: [], isTest: false, staleTypeRefs: [], subTypeCount: 0 });
    expect(codes(r)).toContain('supertypes-changed');
    const removed = typeDiff({ status: 'removed', oldType: o, file: 'A.java' });
    const rr = scoreType({ td: removed, memberRisks: [], isTest: false, staleTypeRefs: ['src/B.java'], subTypeCount: 0 });
    expect(rr.level).toBe('critical');
  });

  it('dosya riski = en yüksek + küçük katkı', () => {
    const mk = (score: number) => ({ score, level: riskLevel(score), reasons: [{ code: 'x', message: 'x', weight: score }] });
    expect(scoreJavaFile([mk(40)], [mk(40), mk(30), mk(30)]).score).toBe(44);
    expect(scoreJavaFile([], []).score).toBe(0);
  });

  it('Java dışı: build, config, migration', () => {
    const base = (path: string, lines: string[], status: FileChange['status'] = 'modified') =>
      ({ path, status, language: path.endsWith('.sql') ? 'sql' : path.endsWith('.yml') ? 'yaml' : 'xml', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '', lines: lines.map((t) => ({ type: 'add', newNo: 1, text: t })) }], additions: 1, deletions: 0, isTest: false, cosmeticOnly: false }) as Pick<FileChange, 'path' | 'status' | 'language' | 'hunks' | 'additions' | 'deletions' | 'isTest' | 'cosmeticOnly'>;
    expect(scoreNonJavaFile(base('pom.xml', ['<dependency>'])).level).toBe('medium');
    expect(scoreNonJavaFile(base('src/main/resources/application.yml', ['  port: 1'])).level).toBe('medium');
    expect(codes(scoreNonJavaFile(base('src/main/resources/application.yml', ['ddl-auto: update'])))).toContain('risky-config');
    expect(scoreNonJavaFile(base('src/main/resources/db/migration/V2__x.sql', ['alter table'], 'added')).level).toBe('high');
    expect(scoreNonJavaFile(base('src/A.java', []), { unanalyzedJava: true }).reasons[0].code).toBe('unanalyzed');
  });
});

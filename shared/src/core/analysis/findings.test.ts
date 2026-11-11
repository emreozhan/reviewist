import { describe, expect, it } from 'vitest';
import type { FileChange, Finding } from '../../shared/types.js';
import { jMember, jType, memberDiff, typeDiff } from '../testing/builders.js';
import { computeSummary, memberFindings, sortFindings } from './findings.js';
import { emptyRisk, makeRisk } from './util.js';

function fc(path: string, over: Partial<FileChange> = {}): FileChange {
  return {
    id: path, path, status: 'modified', language: 'java', binary: false, additions: 3, deletions: 1, hunks: [], layer: 'service',
    isTest: false, cosmeticOnly: false, typeIds: [], relatedTestFiles: [], risk: emptyRisk(), reviewOrder: 0, ...over,
  };
}

describe('findings', () => {
  it('sıralama: önem, kategori, dosya; tekrar eden id tekilleşir', () => {
    const f = (id: string, severity: Finding['severity'], category: Finding['category'], file = 'a'): Finding => ({ id, severity, category, title: id, message: id, file });
    const out = sortFindings([f('t', 'warning', 'test'), f('x', 'info', 'risk'), f('c', 'error', 'callers'), f('a', 'warning', 'api', 'b'), f('a2', 'warning', 'api', 'a'), f('t', 'error', 'test')]);
    expect(out.map((x) => `${x.severity}:${x.id}`)).toEqual(['error:c', 'error:t', 'warning:a2', 'warning:a', 'info:x']);
  });

  it('üye bulguları: silinmiş-ama-çağrılan error, sözleşmeyi izleyen implementasyon bulgu üretmez', () => {
    const m = jMember({ ownerFqn: 'com.acme.U', name: 'old' });
    const md = memberDiff({ status: 'removed', oldMember: m });
    md.change.risk = makeRisk([
      { code: 'removed-with-callers', message: 'Silindi ama çağrılıyor', weight: 65 },
      { code: 'public-api-removed', message: 'public üye silindi', weight: 35 },
    ]);
    const owner = typeDiff({ status: 'modified', oldType: jType({ fqn: 'com.acme.U' }), newType: jType({ fqn: 'com.acme.U' }), file: 'U.java', members: [md] }).change;
    const stale = [{ fromId: 'com.acme.P#next(String)', file: 'P.java', line: 14, inChangedCode: false, confidence: 'exact' as const }];
    const out = memberFindings({ mc: md.change, owner, file: fc('U.java'), staleCalls: stale, outsideCallers: 0 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'callers:removed-with-callers:com.acme.U#old()', severity: 'error', line: 1 });
    expect(out[0].message).toContain('P.java:14');
    expect(out[0].symbolIds).toEqual(['com.acme.U#old()', 'com.acme.P#next(String)']);

    const impl = memberDiff({ status: 'signatureChanged', oldMember: m, newMember: m, flags: ['params'] });
    impl.change.risk = makeRisk([{ code: 'public-api-signature', message: 'x', weight: 35 }]);
    expect(memberFindings({ mc: impl.change, owner, file: fc('U.java'), staleCalls: [], outsideCallers: 0, followsChangedContract: true })).toEqual([]);
    expect(memberFindings({ mc: impl.change, owner, file: fc('U.java'), staleCalls: [], outsideCallers: 3 })[0].message).toContain('Diff dışında 3 çağıranı var');
  });

  it('özet', () => {
    const m = jMember({ ownerFqn: 'com.acme.U', name: 'a' });
    const md = memberDiff({ status: 'signatureChanged', oldMember: m, newMember: m, flags: ['params'] });
    md.change.risk = makeRisk([{ code: 'x', message: 'x', weight: 50 }]);
    const cos = memberDiff({ status: 'cosmetic', oldMember: m, newMember: m });
    const td = typeDiff({ status: 'modified', oldType: jType({ fqn: 'com.acme.U' }), newType: jType({ fqn: 'com.acme.U' }), file: 'U.java', members: [md, cos] });
    const s = computeSummary([fc('U.java', { typeIds: ['com.acme.U'] }), fc('T.java', { isTest: true, cosmeticOnly: true }), fc('a.yml', { language: 'yaml' })], [td.change], 4, 1);
    expect(s).toEqual({
      files: 3, javaFiles: 2, testFiles: 1, additions: 9, deletions: 3, typesChanged: 1, membersChanged: 1, publicApiChanges: 1,
      cosmeticFiles: 1, highRiskItems: 1, impactedOutsideDiff: 4, untestedChanges: 1,
    });
  });
});

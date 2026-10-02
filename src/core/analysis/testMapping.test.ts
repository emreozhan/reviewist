import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../shared/types.js';
import { jMember, jType, memberDiff, typeDiff } from '../testing/builders.js';
import { emptyRisk } from './util.js';
import { TestLocator, testFindings } from './testMapping.js';

function fc(path: string, over: Partial<FileChange> = {}): FileChange {
  return {
    id: path, path, status: 'modified', language: 'java', binary: false, additions: 1, deletions: 1, hunks: [], layer: 'service',
    isTest: false, cosmeticOnly: false, typeIds: [], relatedTestFiles: [], risk: emptyRisk(), reviewOrder: 0, ...over,
  };
}

const prod = (name: string, status: 'modified' | 'added' = 'modified') => {
  const fqn = `com.acme.${name}`;
  const m = jMember({ ownerFqn: fqn, name: 'run' });
  return typeDiff({
    status,
    oldType: status === 'added' ? undefined : jType({ fqn }),
    newType: jType({ fqn }),
    file: `src/main/java/com/acme/${name}.java`,
    members: [memberDiff({ status: status === 'added' ? 'added' : 'modified', oldMember: status === 'added' ? undefined : m, newMember: m, flags: ['body'] })],
  });
};

describe('TestLocator', () => {
  it('ad kalıpları ve referans veren testler', () => {
    const loc = new TestLocator(
      ['src/test/java/com/acme/FooTest.java', 'src/test/java/com/acme/FooIT.java', 'src/test/java/com/acme/TestFoo.java', 'src/test/groovy/FooSpec.groovy', 'src/test/java/com/acme/BarTest.java', 'src/main/java/com/acme/FooTest.java'],
      (fqn) => (fqn === 'com.acme.Foo' ? ['src/test/java/com/acme/BarTest.java', 'src/main/java/com/acme/Other.java'] : []),
    );
    const d = loc.findDetailed('src/main/java/com/acme/Foo.java', [{ fqn: 'com.acme.Foo', name: 'Foo' }]);
    expect(d.byName).toContain('src/test/java/com/acme/FooTest.java');
    expect(d.byName).toContain('src/test/java/com/acme/FooIT.java');
    expect(d.byName).toContain('src/test/java/com/acme/TestFoo.java');
    expect(d.byName).toContain('src/test/groovy/FooSpec.groovy');
    expect(d.byReference).toEqual(['src/test/java/com/acme/BarTest.java']);
    expect(loc.find('x', [{ fqn: 'com.acme.Zed', name: 'Zed' }])).toEqual([]);
  });
});

describe('testFindings', () => {
  it('test yok / yeni sınıf testsiz / test güncellenmemiş', () => {
    const noTest = prod('NoTest');
    const fresh = prod('Fresh', 'added');
    const stale = prod('Stale');
    const updated = prod('Updated');
    const items = [
      { file: fc(noTest.change.file), typeDiffs: [noTest] },
      { file: fc(fresh.change.file, { status: 'added' }), typeDiffs: [fresh] },
      { file: fc(stale.change.file, { relatedTestFiles: ['src/test/StaleTest.java', 'src/test/OtherTest.java'] }), typeDiffs: [stale], primaryTests: ['src/test/StaleTest.java'] },
      { file: fc(updated.change.file, { relatedTestFiles: ['src/test/UpdatedTest.java'] }), typeDiffs: [updated] },
    ];
    const { findings, untested } = testFindings(items, new Set(['src/test/UpdatedTest.java', 'src/test/OtherTest.java']), true);
    const ids = findings.map((f) => f.id).sort();
    expect(ids).toEqual(['test:new-untested:com.acme.Fresh', 'test:stale:src/main/java/com/acme/Stale.java', 'test:untested:com.acme.NoTest']);
    expect(untested).toBe(2);
    expect(findings.find((f) => f.id.startsWith('test:stale'))?.message).toContain('StaleTest.java');
  });

  it('repo dosya listesi yoksa "test yok" üretmez; arayüz ve yalnızca silme atlanır', () => {
    const t = prod('A');
    expect(testFindings([{ file: fc(t.change.file), typeDiffs: [t] }], new Set(), false).findings).toEqual([]);
    const iface = typeDiff({ status: 'modified', oldType: jType({ fqn: 'com.acme.P', kind: 'interface' }), newType: jType({ fqn: 'com.acme.P', kind: 'interface' }), file: 'P.java', members: [memberDiff({ status: 'added', newMember: jMember({ ownerFqn: 'com.acme.P', name: 'x' }) })] });
    iface.change.layer = 'port';
    const removedOnly = typeDiff({ status: 'modified', oldType: jType({ fqn: 'com.acme.U' }), newType: jType({ fqn: 'com.acme.U' }), file: 'U.java', members: [memberDiff({ status: 'removed', oldMember: jMember({ ownerFqn: 'com.acme.U', name: 'x' }) })] });
    const r = testFindings([{ file: fc('P.java'), typeDiffs: [iface] }, { file: fc('U.java'), typeDiffs: [removedOnly] }], new Set(), true);
    expect(r.findings).toEqual([]);
  });
});

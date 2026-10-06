/**
 * ASCII dışı (Türkçe) tanımlayıcılar: tip referansları, alıcı çözümü, çağıranlar, bayat çağrı ve test eşleme.
 */
import { describe, expect, it } from 'vitest';
import type { ReviewModel } from '../shared/types.js';
import { buildReview } from './buildReview.js';
import { parseJavaFile, RepoIndex } from './java/index.js';
import { escapeRegExp, identWordRegExp, IDENT_EXACT_RE, isTestPath, referencedSimpleNames, typeParamNames } from './java/names.js';
import { createMemoryChangeSet } from './testing/memoryChangeSet.js';

const P = 'src/main/java/p';
const member = (model: ReviewModel, id: string) => model.types.flatMap((t) => t.members).find((m) => m.id === id);

describe('Unicode tanımlayıcılar', () => {
  it('ortak desenler: Türkçe harfler tanımlayıcı, kelime sınırı Unicode', () => {
    expect(IDENT_EXACT_RE.test('Sipariş')).toBe(true);
    expect(IDENT_EXACT_RE.test('şube2')).toBe(true);
    expect(IDENT_EXACT_RE.test('2şube')).toBe(false);
    expect(identWordRegExp('Şube').test('new Şube()')).toBe(true);
    expect(identWordRegExp('Şube').test('AnaŞube x')).toBe(false);
    expect(identWordRegExp('Şube').test('Şubeler x')).toBe(false);
    expect(referencedSimpleNames('Map<String, List<Sipariş>>')).toEqual(['Map', 'String', 'List', 'Sipariş']);
    expect(typeParamNames('<Ö extends Şube, U>')).toEqual(['Ö', 'U']);
    expect(escapeRegExp('a.b$')).toBe('a\\.b\\$');
    expect(isTestPath('src/test/java/p/İşlemTest.java')).toBe(true);
  });

  it('class Sipariş: tip referansı, alıcı çözümü ve çağıranlar', async () => {
    const sube = await parseJavaFile(`${P}/Şube.java`, 'package p;\n\npublic class Şube {\n    public void kapat() {}\n}\n');
    const sip = await parseJavaFile(
      `${P}/Sipariş.java`,
      'package p;\n\npublic class Sipariş {\n    void işle() {\n        Şube şube = new Şube();\n        şube.kapat();\n    }\n}\n',
    );
    expect(sip.types[0]?.fqn).toBe('p.Sipariş');
    expect(sip.typeRefs).toContain('Şube');
    const index = RepoIndex.build([sube, sip]);
    expect(index.filesReferencingType('p.Şube')).toEqual([`${P}/Sipariş.java`]);
    const callers = index.callersOf('p.Şube#kapat()');
    expect(callers).toEqual([expect.objectContaining({ fromId: 'p.Sipariş#işle()', line: 6, confidence: 'exact' })]);
  });

  it('silinen metodun Türkçe adlı alıcı üzerinden çağrısı bayat; İşlemTest → İşlem test eşlemesi', async () => {
    const S = (withKapat: boolean) => `package p;\n\npublic class Şube {\n${withKapat ? '    public void kapat() {}\n' : ''}    public int no() { return 1; }\n}\n`;
    const I = (body: string) => `package p;\n\npublic class İşlem {\n    public int çalıştır() { return ${body}; }\n}\n`;
    const cs = createMemoryChangeSet({
      old: { [`${P}/Şube.java`]: S(true), [`${P}/İşlem.java`]: I('1') },
      new: { [`${P}/Şube.java`]: S(false), [`${P}/İşlem.java`]: I('2') },
      extraNewFiles: {
        [`${P}/Sipariş.java`]: 'package p;\n\npublic class Sipariş {\n    void işle() {\n        Şube şube = new Şube();\n        şube.kapat();\n    }\n}\n',
        'src/test/java/p/İşlemTest.java': 'package p;\n\nclass İşlemTest {\n    void t() { new İşlem().çalıştır(); }\n}\n',
      },
    });
    const model = await buildReview(cs);
    const f = model.findings.find((x) => x.id === 'callers:removed-with-callers:p.Şube#kapat()');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain(`${P}/Sipariş.java:6`);
    expect(member(model, 'p.İşlem#çalıştır()')?.status).toBe('modified');
    expect(model.files.find((x) => x.path === `${P}/İşlem.java`)?.relatedTestFiles).toEqual(['src/test/java/p/İşlemTest.java']);
  });
});

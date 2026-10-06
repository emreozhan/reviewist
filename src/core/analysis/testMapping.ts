/**
 * Üretim tipi → test dosyası eşlemesi ve test bulguları.
 * Ad kalıpları: FooTest, FooTests, FooIT, FooITCase, FooIntegrationTest, FooSpec, TestFoo (.java/.kt/.groovy)
 * + indeksteki tipe referans veren test dosyaları.
 */
import type { FileChange, Finding } from '../../shared/types.js';
import type { TypeDiff } from '../java/model.js';
import { isTestPath } from './layers.js';
import { isSemanticChange } from './risk.js';
import { basename, RISK_LEVEL_ORDER } from './util.js';

const SUFFIXES = ['Test', 'Tests', 'IT', 'ITCase', 'IntegrationTest', 'Spec'];
const EXTS = ['.java', '.kt', '.groovy'];

export class TestLocator {
  private readonly byBase = new Map<string, string[]>();

  constructor(
    repoFiles: Iterable<string>,
    private readonly referencing: (fqn: string) => string[] = () => [],
  ) {
    for (const p of repoFiles) {
      const b = basename(p);
      const list = this.byBase.get(b);
      if (list) list.push(p);
      else this.byBase.set(b, [p]);
    }
  }

  /** Verilen üst düzey tipler için test dosyaları (sıralı, tekrarsız). */
  find(path: string, types: readonly { fqn: string; name: string }[]): string[] {
    const { byName, byReference } = this.findDetailed(path, types);
    return [...new Set([...byName, ...byReference])].sort();
  }

  /** Ad kalıbıyla eşleşen testler ve yalnızca tipe referans veren testler ayrı ayrı. */
  findDetailed(path: string, types: readonly { fqn: string; name: string }[]): { byName: string[]; byReference: string[] } {
    const byName = new Set<string>();
    const byReference = new Set<string>();
    for (const t of types) {
      const candidates = [...SUFFIXES.map((s) => `${t.name}${s}`), `Test${t.name}`];
      for (const c of candidates) for (const e of EXTS) for (const p of this.byBase.get(`${c}${e}`) ?? []) if (isTestPath(p)) byName.add(p);
    }
    for (const t of types) for (const p of this.referencing(t.fqn)) if (isTestPath(p) && !byName.has(p)) byReference.add(p);
    byName.delete(path);
    byReference.delete(path);
    return { byName: [...byName].sort(), byReference: [...byReference].sort() };
  }
}

export interface TestFindingInput {
  file: FileChange;
  typeDiffs: readonly TypeDiff[];
  /** Ad kalıbıyla eşleşen (asıl) testler; varsa "test güncellenmemiş" kontrolü bunlarla yapılır. */
  primaryTests?: readonly string[];
}

const BEHAVIOR_STATUSES = new Set(['modified', 'signatureChanged', 'removed', 'renamed', 'moved', 'added']);

function eligibleTypes(tds: readonly TypeDiff[]): TypeDiff[] {
  return tds.filter((td) => {
    const t = td.newType;
    if (!t || t.outerFqn) return false;
    if (td.change.kind === 'annotation') return false;
    // Arayüzler implementasyonları üzerinden test edilir; Spring Data repository arayüzleri (@Query vb.) istisna.
    if (td.change.kind === 'interface' && td.change.layer !== 'repository' && !(td.change.layer === 'adapter-out' && /Repository$/.test(td.change.name))) return false;
    if (td.change.status === 'removed') return false;
    if (td.change.status === 'added') return true;
    // Yalnızca üye silinmesi test edilecek davranış üretmez (silinen kodun çağıranları ayrı bulgu).
    return td.members.some((m) => isSemanticChange(m.change.status) && m.change.status !== 'removed');
  });
}

function behaviorChanged(td: TypeDiff): boolean {
  return td.members.some((m) => BEHAVIOR_STATUSES.has(m.change.status) && (m.change.visibility !== 'private' || m.change.risk.score >= 20 || m.change.status !== 'added'));
}

/**
 * Test bulguları ve test edilmemiş değişen üretim tipi sayısı.
 * repoFilesKnown false ise (kaynak dosya listesi vermiyor) "test yok" bulgusu üretilmez.
 */
export function testFindings(items: readonly TestFindingInput[], changedPaths: ReadonlySet<string>, repoFilesKnown: boolean): { findings: Finding[]; untested: number } {
  const findings: Finding[] = [];
  let untested = 0;
  for (const { file, typeDiffs, primaryTests } of items) {
    if (file.isTest || file.cosmeticOnly || file.status === 'deleted' || file.language !== 'java') continue;
    const types = eligibleTypes(typeDiffs);
    if (types.length === 0) continue;
    if (file.relatedTestFiles.length === 0) {
      if (!repoFilesKnown) continue;
      for (const td of types) {
        untested++;
        const ch = td.change;
        const lowValue = ch.kind === 'enum' || ch.kind === 'record' || ch.layer === 'config' || ch.layer === 'model';
        const isNew = ch.status === 'added';
        findings.push({
          id: `test:${isNew ? 'new-untested' : 'untested'}:${ch.id}`,
          severity: lowValue ? 'info' : 'warning',
          category: 'test',
          title: isNew ? `Yeni ${ch.visibility === 'public' ? 'public ' : ''}sınıfın testi yok: ${ch.name}` : `Test yok: ${ch.name}`,
          message: isNew
            ? `${ch.name} bu diff'te eklendi ama repoda ona ait test bulunamadı (${ch.name}Test vb. ya da onu kullanan bir test dosyası yok).`
            : `${ch.name} değişti ama repoda ona ait test bulunamadı (${ch.name}Test/${ch.name}Tests/${ch.name}IT ya da onu referans eden test yok). Değişikliğin davranışı doğrulanmıyor.`,
          file: file.path,
          line: ch.newRange?.startLine,
          symbolIds: [ch.id],
        });
      }
      continue;
    }
    // Asıl (ad kalıplı) testler varsa onlara bakılır: başka bir testin tipi kullanıp değişmiş olması asıl testin güncellendiği anlamına gelmez.
    const checkTests = primaryTests && primaryTests.length > 0 ? primaryTests : file.relatedTestFiles;
    const changedTests = checkTests.filter((p) => changedPaths.has(p));
    if (changedTests.length > 0) continue;
    const changedTypes = types.filter(behaviorChanged);
    if (changedTypes.length === 0) continue;
    const signature = changedTypes.some((td) => td.members.some((m) => m.change.status === 'signatureChanged' || m.change.status === 'removed' || m.change.status === 'renamed'));
    const highRisk = RISK_LEVEL_ORDER[file.risk.level] >= RISK_LEVEL_ORDER.high;
    findings.push({
      id: `test:stale:${file.path}`,
      severity: signature || highRisk ? 'warning' : 'info',
      category: 'test',
      title: `İlgili test güncellenmemiş: ${changedTypes.map((t) => t.change.name).join(', ')}`,
      message: `${changedTypes.map((t) => t.change.name).join(', ')} davranışı değişti ama ilgili test dosyaları bu diff'te değişmemiş: ${checkTests.slice(0, 4).map(basename).join(', ')}${checkTests.length > 4 ? ' ...' : ''}. Testlerin yeni davranışı kapsayıp kapsamadığını kontrol edin.`,
      file: file.path,
      symbolIds: changedTypes.map((t) => t.change.id),
    });
  }
  return { findings, untested };
}

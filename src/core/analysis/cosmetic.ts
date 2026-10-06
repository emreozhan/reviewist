/**
 * Kozmetik (yalnızca biçim/import/yorum) değişiklik tespiti ve AI gürültüsü bulguları.
 */
import type { DiffHunk, Finding } from '../../shared/types.js';
import type { JavaFileModel, TypeDiff } from '../java/model.js';
import { identWordRegExp } from '../java/names.js';
import { isSemanticChange } from './risk.js';

/**
 * Java dosyası kozmetik mi: tüm tipler cosmetic/unchanged, paket aynı, tip eklenip silinmemiş.
 * Kod (importlar hariç normalize metin) aynıyken import farkı yalnızca sıra veya kullanılmayan importlardır.
 */
export function isCosmeticJava(status: string, oldModel: JavaFileModel | undefined, newModel: JavaFileModel | undefined, typeDiffs: readonly TypeDiff[]): boolean {
  if (status === 'added' || status === 'deleted' || status === 'copied') return false;
  if (!oldModel || !newModel) return false;
  if (oldModel.packageName !== newModel.packageName) return false;
  if (typeDiffs.some((td) => isSemanticChange(td.change.status))) return false;
  if (typeDiffs.some((td) => td.members.some((m) => isSemanticChange(m.change.status)))) return false;
  // Tipsiz dosya (package-info / module-info): paket anotasyonu veya requires/exports değişikliği kod farkıdır.
  if (typeDiffs.length === 0 && oldModel.normalizedCode !== newModel.normalizedCode) return false;
  // Aynı basit adın import hedefi değiştiyse (javax → jakarta) kod aynı görünse de anlam değişir.
  if (importRetargets(oldModel, newModel).length > 0) return false;
  const staticImports = (m: JavaFileModel) => m.imports.filter((i) => i.static).map((i) => `${i.name}${i.wildcard ? '.*' : ''}`).sort().join(',');
  // Statik import değişikliği, kod aynıyken bile hangi metodun çağrıldığını değiştirebilir.
  if (staticImports(oldModel) !== staticImports(newModel) && oldModel.normalizedCode !== newModel.normalizedCode) return false;
  return true;
}

export interface ImportRetarget {
  /** Basit ad ('Entity'); wildcard importta '*'. */
  name: string;
  from: string;
  to: string;
}

/** Anlam taşıyan (çalışma zamanı/çerçeve davranışını belirleyen) paketler: hedef değişimi orta risk. */
const MEANINGFUL_IMPORT_PREFIXES = [
  'javax.', 'jakarta.', 'org.springframework.', 'org.hibernate.', 'com.fasterxml.', 'org.junit.', 'org.mockito.',
  'lombok.', 'io.micronaut.', 'io.quarkus.', 'java.', 'reactor.', 'io.reactivex.', 'org.slf4j.', 'org.aspectj.',
];

export function isMeaningfulImport(name: string): boolean {
  return MEANINGFUL_IMPORT_PREFIXES.some((p) => name.startsWith(p));
}

function lastSegment(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1) : name;
}

/** 'javax.persistence' ↔ 'jakarta.persistence': ilk segment dışında aynı. */
function samePackageTail(a: string, b: string): boolean {
  const ta = a.slice(a.indexOf('.') + 1);
  const tb = b.slice(b.indexOf('.') + 1);
  return a !== b && a.includes('.') && b.includes('.') && ta === tb;
}

/**
 * Aynı basit adın farklı FQN'e bağlandığı import değişiklikleri (tekil importlar; statik importlar dahil) ve
 * wildcard paket değişimi ('javax.persistence.*' → 'jakarta.persistence.*'). Yalnız sıralama veya kullanılmayan
 * import ekleme/silme boş liste döner.
 */
export function importRetargets(oldModel: JavaFileModel, newModel: JavaFileModel): ImportRetarget[] {
  const single = (m: JavaFileModel) => {
    const out = new Map<string, string>();
    for (const i of m.imports) if (!i.wildcard) out.set(`${i.static ? 'static ' : ''}${lastSegment(i.name)}`, i.name);
    return out;
  };
  const a = single(oldModel);
  const b = single(newModel);
  const out: ImportRetarget[] = [];
  // Kullanılmayan import (kodda basit adı geçmiyor) anlam taşımaz: kozmetik kalır.
  const code = newModel.normalizedCode;
  const used = (name: string) => identWordRegExp(name).test(code);
  for (const [key, from] of a) {
    const to = b.get(key);
    if (to !== undefined && to !== from && used(lastSegment(from))) out.push({ name: lastSegment(from), from, to });
  }
  const wild = (m: JavaFileModel) => new Set(m.imports.filter((i) => i.wildcard && !i.static).map((i) => i.name));
  const wa = wild(oldModel);
  const wb = wild(newModel);
  const removed = [...wa].filter((x) => !wb.has(x));
  const added = [...wb].filter((x) => !wa.has(x));
  for (const r of removed) {
    const to = added.find((x) => samePackageTail(r, x));
    if (to) out.push({ name: '*', from: `${r}.*`, to: `${to}.*` });
  }
  return out;
}

export function describeRetarget(r: ImportRetarget): string {
  return `import hedefi değişti: ${r.from} → ${r.to}`;
}

/** Java dışı dosya: hunk'larda yalnızca boşluk farkı var mı. */
export function isWhitespaceOnly(hunks: readonly DiffHunk[]): boolean {
  if (hunks.length === 0) return false;
  for (const h of hunks) {
    const del = h.lines.filter((l) => l.type === 'del').map((l) => l.text).join('').replace(/\s+/g, '');
    const add = h.lines.filter((l) => l.type === 'add').map((l) => l.text).join('').replace(/\s+/g, '');
    if (del !== add) return false;
  }
  return true;
}

/** Import farkının türü (ayrıntı metni için). */
export function describeImportDiff(oldModel: JavaFileModel, newModel: JavaFileModel): string | undefined {
  const key = (i: { name: string; static: boolean; wildcard: boolean }) => `${i.static ? 'static ' : ''}${i.name}${i.wildcard ? '.*' : ''}`;
  const a = oldModel.imports.map(key);
  const b = newModel.imports.map(key);
  if (a.join('\n') === b.join('\n')) return undefined;
  const sa = new Set(a);
  const sb = new Set(b);
  const added = b.filter((x) => !sa.has(x));
  const removed = a.filter((x) => !sb.has(x));
  if (!added.length && !removed.length) return 'importlar yeniden sıralandı';
  const parts: string[] = [];
  if (added.length) parts.push(`${added.length} import eklendi`);
  if (removed.length) parts.push(`${removed.length} import kaldırıldı`);
  return parts.join(', ');
}

export interface CosmeticStats {
  files: number;
  cosmeticFiles: string[];
  changedMembers: number;
  cosmeticMembers: number;
}

/** Kozmetik bulguları: dosya özeti ve AI'a özgü biçim gürültüsü. */
export function cosmeticFindings(stats: CosmeticStats): Finding[] {
  const out: Finding[] = [];
  const n = stats.cosmeticFiles.length;
  if (n > 0) {
    out.push({
      id: 'cosmetic:files',
      severity: 'info',
      category: 'cosmetic',
      title: `${n} dosya yalnızca biçim değişikliği içeriyor`,
      message: `${n} dosya yalnızca biçim/import/yorum değişikliği içeriyor, hızlıca geçilebilir: ${stats.cosmeticFiles.slice(0, 8).join(', ')}${n > 8 ? ` ve ${n - 8} dosya daha` : ''}.`,
    });
  }
  const ratio = stats.files > 0 ? n / stats.files : 0;
  const memberRatio = stats.changedMembers > 0 ? stats.cosmeticMembers / stats.changedMembers : 0;
  if ((n >= 3 && ratio >= 0.3) || (stats.cosmeticMembers >= 5 && memberRatio >= 0.4)) {
    const parts: string[] = [];
    if (n >= 3 && ratio >= 0.3) parts.push(`dosyaların %${Math.round(ratio * 100)}'i (${n}/${stats.files})`);
    if (stats.cosmeticMembers >= 5 && memberRatio >= 0.4) parts.push(`değişen üyelerin %${Math.round(memberRatio * 100)}'i (${stats.cosmeticMembers}/${stats.changedMembers})`);
    out.push({
      id: 'cosmetic:ai-noise',
      severity: 'info',
      category: 'cosmetic',
      title: 'Diff\'in büyük kısmı biçimsel gürültü',
      message: `Bu diff'te ${parts.join(' ve ')} yalnızca biçim/javadoc/import değişikliği. AI araçlarının yeniden biçimlendirmesi olabilir; anlamlı değişiklikler gürültüde kaybolmasın diye okuma planı kozmetik dosyaları en sona koydu. Biçim değişikliklerini ayrı bir commit'e ayırmayı önerin.`,
    });
  }
  return out;
}

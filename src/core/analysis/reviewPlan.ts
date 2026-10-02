/**
 * Okuma planı. Dosya sırası:
 *  1. Sözleşmeler: arayüzler/port'lar (1a), soyut temel sınıflar (1b), domain modeli (1c)
 *  2. Uygulama kodu: bağımlılık sırası (çağrılan önce, çağıran sonra; üst tip önce) — değişen semboller arasında topolojik,
 *     döngüde risk sırası
 *  3. Adapter'lar (adapter-in/out, controller, repository)
 *  4. Yapılandırma / build / kaynak ve diğer Java dışı dosyalar
 *  5. Her üretim dosyasının (diff'teki) testleri hemen arkasından; eşleşmeyen testler kozmetiklerden önce
 *  6. Kozmetik dosyalar en sonda
 */
import type { FileChange, Layer, ReviewStep, RiskLevel } from '../../shared/types.js';
import type { TypeDiff } from '../java/model.js';
import { isBreakingSignature, isSemanticChange } from './risk.js';
import { basename, RISK_LEVEL_ORDER, symbolLabel } from './util.js';

const LEVEL_TR: Record<RiskLevel, string> = { low: 'düşük', medium: 'orta', high: 'yüksek', critical: 'kritik' };
const ADAPTER_LAYERS = new Set<Layer>(['adapter-in', 'adapter-out', 'controller', 'repository']);
const STATUS_TR: Record<string, string> = {
  signatureChanged: 'imzası değişti',
  annotationChanged: 'anotasyonu değişti',
  added: 'eklendi',
  removed: 'silindi',
  modified: 'davranışı değişti',
  renamed: 'yeniden adlandırıldı',
  moved: 'taşındı',
};

type Category = '1a' | '1b' | '1c' | '2' | '3' | '4' | 'test' | '6';
const CAT_ORDER: Record<Category, number> = { '1a': 0, '1b': 1, '1c': 2, '2': 3, '3': 4, '4': 5, test: 6, '6': 7 };

interface Node {
  file: FileChange;
  tds: TypeDiff[];
  cat: Category;
  deps: Set<string>; // önce okunması gereken dosyalar
  dependents: Set<string>;
}

function semanticTypes(tds: readonly TypeDiff[]): TypeDiff[] {
  return tds.filter((td) => isSemanticChange(td.change.status) || td.members.some((m) => isSemanticChange(m.change.status)));
}

function categorize(file: FileChange, tds: readonly TypeDiff[]): Category {
  if (file.cosmeticOnly) return '6';
  if (file.isTest) return 'test';
  if (tds.length === 0) return file.language === 'java' || file.language === 'kotlin' ? '2' : '4';
  const sem = semanticTypes(tds);
  const consider = sem.length ? sem : tds;
  // Adapter katmanındaki arayüzler (ör. Spring Data repository) sözleşme değil, adapter ayrıntısıdır.
  if (file.layer === 'port' || consider.some((td) => td.change.kind === 'interface' && !ADAPTER_LAYERS.has(td.change.layer) && !ADAPTER_LAYERS.has(file.layer))) return '1a';
  if (consider.some((td) => (td.newType ?? td.oldType)?.modifiers.includes('abstract') && td.change.kind === 'class')) return '1b';
  if (file.layer === 'domain' || file.layer === 'model') return '1c';
  if (ADAPTER_LAYERS.has(file.layer)) return '3';
  if (file.layer === 'config' || file.layer === 'build' || file.layer === 'resource') return '4';
  return '2';
}

/** Değişen üyelerin durum özetini üretir: '2 üye imzası değişti, 1 üye eklendi'. */
export function changeSummary(tds: readonly TypeDiff[], file?: FileChange): string {
  const counts = new Map<string, number>();
  for (const td of tds) {
    for (const m of td.members) {
      if (!isSemanticChange(m.change.status)) continue;
      const key = m.change.status === 'signatureChanged' && !isBreakingSignature(m.change) ? 'annotationChanged' : m.change.status;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const order = ['signatureChanged', 'removed', 'renamed', 'moved', 'added', 'annotationChanged', 'modified'];
  const parts = order.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} üye ${STATUS_TR[s]}`);
  if (parts.length) return parts.join(', ');
  const t = tds.find((td) => isSemanticChange(td.change.status));
  if (t) return `${t.change.name} tipi ${STATUS_TR[t.change.status] ?? 'değişti'}`;
  if (file?.status === 'added') return 'yeni dosya';
  if (file?.status === 'deleted') return 'dosya silindi';
  return 'değişiklik';
}

function memberSymbolIds(tds: readonly TypeDiff[]): string[] {
  const mems = tds.flatMap((td) => td.members.filter((m) => isSemanticChange(m.change.status)).map((m) => m.change));
  mems.sort((a, b) => b.risk.score - a.risk.score || a.id.localeCompare(b.id));
  const ids = mems.map((m) => m.id);
  if (ids.length) return [...new Set(ids)];
  return tds.filter((td) => isSemanticChange(td.change.status)).map((td) => td.change.id);
}

function riskSuffix(file: FileChange): string {
  if (RISK_LEVEL_ORDER[file.risk.level] < RISK_LEVEL_ORDER.high) return '';
  const top = [...file.risk.reasons].sort((a, b) => b.weight - a.weight)[0];
  return ` — risk ${LEVEL_TR[file.risk.level]}${top ? `: ${top.message}` : ''}`;
}

/**
 * Okuma planını üretir ve FileChange.reviewOrder alanlarını doldurur.
 */
export function buildReviewPlan(files: readonly FileChange[], typeDiffsByFile: ReadonlyMap<string, readonly TypeDiff[]>): ReviewStep[] {
  const nodes = new Map<string, Node>();
  for (const f of files) {
    const tds = [...(typeDiffsByFile.get(f.path) ?? [])];
    nodes.set(f.path, { file: f, tds, cat: categorize(f, tds), deps: new Set(), dependents: new Set() });
  }

  // Sembol → dosya (değişen semboller)
  const symFile = new Map<string, string>();
  for (const n of nodes.values()) {
    if (n.cat === '6' || n.cat === 'test') continue;
    for (const td of n.tds) {
      if (isSemanticChange(td.change.status) || td.members.some((m) => isSemanticChange(m.change.status))) symFile.set(td.change.id, n.file.path);
      for (const m of td.members) if (isSemanticChange(m.change.status)) symFile.set(m.change.id, n.file.path);
    }
  }
  const link = (before: string | undefined, after: string) => {
    if (!before || before === after) return;
    const a = nodes.get(after);
    const b = nodes.get(before);
    if (!a || !b) return;
    a.deps.add(before);
    b.dependents.add(after);
  };
  for (const n of nodes.values()) {
    if (n.cat === '6' || n.cat === 'test') continue;
    for (const td of n.tds) {
      for (const sup of td.change.superTypes) link(symFile.get(sup), n.file.path);
      for (const m of td.members) {
        if (!isSemanticChange(m.change.status)) continue;
        for (const c of m.change.callees) link(symFile.get(c), n.file.path);
        for (const c of m.change.callers) if (symFile.has(c.fromId)) link(n.file.path, symFile.get(c.fromId) as string);
      }
    }
  }

  // Kahn: hazır düğümlerden (kategori, risk) önceliğiyle; döngüde en öncelikli kalan zorla seçilir.
  const prod = [...nodes.values()].filter((n) => n.cat !== '6' && n.cat !== 'test');
  const prio = (a: Node, b: Node) => CAT_ORDER[a.cat] - CAT_ORDER[b.cat] || b.file.risk.score - a.file.risk.score || a.file.path.localeCompare(b.file.path);
  const remaining = new Map(prod.map((n) => [n.file.path, new Set([...n.deps].filter((d) => nodes.get(d)?.cat !== '6'))]));
  const rank = new Map<string, number>();
  while (remaining.size) {
    const ready = [...remaining.entries()].filter(([, d]) => d.size === 0).map(([p]) => nodes.get(p) as Node);
    const pick = (ready.length ? ready : [...remaining.keys()].map((p) => nodes.get(p) as Node)).sort(prio)[0];
    rank.set(pick.file.path, rank.size);
    remaining.delete(pick.file.path);
    for (const d of remaining.values()) d.delete(pick.file.path);
  }
  prod.sort((a, b) => CAT_ORDER[a.cat] - CAT_ORDER[b.cat] || (rank.get(a.file.path) ?? 0) - (rank.get(b.file.path) ?? 0));

  const steps: ReviewStep[] = [];
  const placed = new Set<string>();
  const push = (fileId: string, symbolIds: string[], reason: string) => {
    placed.add(fileId);
    steps.push({ order: steps.length + 1, fileId, symbolIds, reason });
  };
  const tests = [...nodes.values()].filter((n) => n.cat === 'test');
  const subjectOf = attachTests(tests, prod);

  for (const n of prod) {
    push(n.file.path, memberSymbolIds(n.tds), reasonFor(n, placed));
    for (const t of tests) {
      if (placed.has(t.file.path) || subjectOf.get(t.file.path) !== n.file.path) continue;
      const prodName = basename(n.file.path).replace(/\.\w+$/, '');
      push(t.file.path, memberSymbolIds(t.tds), `Test: ${prodName} değişikliklerini doğrulayan test (${changeSummary(t.tds, t.file)})`);
    }
  }
  for (const t of tests.sort((a, b) => b.file.risk.score - a.file.risk.score || a.file.path.localeCompare(b.file.path))) {
    if (!placed.has(t.file.path)) push(t.file.path, memberSymbolIds(t.tds), `Test: ${changeSummary(t.tds, t.file)}`);
  }
  for (const n of [...nodes.values()].filter((x) => x.cat === '6').sort((a, b) => a.file.path.localeCompare(b.file.path))) {
    push(n.file.path, [], 'Yalnızca biçim değişikliği (boşluk/import/yorum); hızlıca geçilebilir');
  }
  for (const s of steps) {
    const f = nodes.get(s.fileId)?.file;
    if (f) f.reviewOrder = s.order;
  }
  return steps;
}

const TEST_STEM_RE = /^(?:Test(?=[A-Z]))?(\w+?)(?:Test|Tests|IT|ITCase|IntegrationTest|Spec)?$/;

/**
 * Her testi okunacağı üretim dosyasına bağlar: önce ad kalıbı (FooTest → Foo), yoksa testi ilişkili sayan
 * üretim dosyalarından plandaki en sonuncusu (test, kullandığı tüm değişikliklerden sonra okunur).
 */
function attachTests(tests: readonly Node[], prod: readonly Node[]): Map<string, string> {
  const byStem = new Map<string, string>();
  for (const n of prod) byStem.set(basename(n.file.path).replace(/\.\w+$/, ''), n.file.path);
  const out = new Map<string, string>();
  for (const t of tests) {
    const stem = basename(t.file.path).replace(/\.\w+$/, '');
    const subject = TEST_STEM_RE.exec(stem)?.[1];
    const byName = subject ? byStem.get(subject) : undefined;
    if (byName) {
      out.set(t.file.path, byName);
      continue;
    }
    const related = prod.filter((n) => n.file.relatedTestFiles.includes(t.file.path));
    if (related.length) out.set(t.file.path, related[related.length - 1].file.path);
  }
  return out;
}

function reasonFor(n: Node, placed: Set<string>): string {
  const summary = changeSummary(n.tds, n.file);
  const sem = semanticTypes(n.tds);
  const main = sem[0] ?? n.tds[0];
  const name = main?.change.name ?? basename(n.file.path);
  const subs = main?.change.subTypes.length ?? 0;
  const earlier = [...n.deps].filter((d) => placed.has(d));
  const depPhrase = earlier.length
    ? `; önceki adımlardaki ${earlier.slice(0, 3).map((d) => basename(d).replace(/\.\w+$/, '')).join(', ')} değişikliklerini kullanıyor`
    : n.dependents.size
      ? `; değişen ${n.dependents.size} dosya buna bağlı, önce bunu okuyun`
      : '';
  let reason: string;
  switch (n.cat) {
    case '1a':
      reason = `Sözleşme: ${name} (${main?.change.kind === 'interface' ? (n.file.layer === 'port' ? 'port arayüzü' : 'arayüz') : 'port'}) — ${summary}${subs ? `; ${subs} implementasyonu etkiliyor` : ''}`;
      break;
    case '1b':
      reason = `Temel sınıf: ${name} soyut sınıfı — ${summary}${subs ? `; ${subs} alt sınıfa yayılıyor` : ''}`;
      break;
    case '1c':
      reason = `Domain modeli: ${name} — ${summary}${depPhrase}`;
      break;
    case '2':
      reason = n.tds.length === 0 ? `İçerik analiz edilemedi; diff'i elle inceleyin` : `Bağımlılık sırası: ${name} — ${summary}${depPhrase}`;
      break;
    case '3':
      reason = `Adapter (${n.file.layer}): ${name} — ${summary}${depPhrase}`;
      break;
    default: {
      const top = [...n.file.risk.reasons].sort((a, b) => b.weight - a.weight)[0];
      reason = `Yapılandırma/build/kaynak: ${top ? top.message : summary}`;
      return reason;
    }
  }
  const topSym = memberSymbolIds(n.tds)[0];
  if (topSym && RISK_LEVEL_ORDER[n.file.risk.level] >= RISK_LEVEL_ORDER.high) return `${reason}${riskSuffix(n.file)} (önce ${symbolLabel(topSym)})`;
  return reason;
}

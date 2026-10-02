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
import { basename, BinaryHeap, RISK_LEVEL_ORDER, symbolLabel } from './util.js';

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

function prioCompare(a: Node, b: Node): number {
  return CAT_ORDER[a.cat] - CAT_ORDER[b.cat] || b.file.risk.score - a.file.risk.score || a.file.path.localeCompare(b.file.path);
}

/** Üretim düğümlerinin okuma sırası (0 tabanlı rank). Bağımlılıklar yalnızca `prod` içindekiler sayılır. */
function topoRank(prod: readonly Node[]): Map<string, number> {
  const inProd = new Set(prod.map((n) => n.file.path));
  const byPath = new Map(prod.map((n) => [n.file.path, n]));
  const indeg = new Map<string, number>();
  for (const n of prod) {
    let d = 0;
    for (const dep of n.deps) if (inProd.has(dep)) d++;
    indeg.set(n.file.path, d);
  }
  const less = (a: Node, b: Node) => prioCompare(a, b) < 0;
  const ready = new BinaryHeap<Node>(less);
  const all = new BinaryHeap<Node>(less); // döngü kırmak için: kalanların en öncelikli olanı (tembel silme)
  for (const n of prod) {
    all.push(n);
    if (indeg.get(n.file.path) === 0) ready.push(n);
  }
  const rank = new Map<string, number>();
  while (rank.size < prod.length) {
    let pick = ready.pop();
    while (pick && rank.has(pick.file.path)) pick = ready.pop();
    if (!pick) {
      pick = all.pop();
      while (pick && rank.has(pick.file.path)) pick = all.pop();
      if (!pick) break;
    }
    rank.set(pick.file.path, rank.size);
    for (const dep of pick.dependents) {
      const d = indeg.get(dep);
      if (d === undefined || rank.has(dep)) continue;
      indeg.set(dep, d - 1);
      if (d - 1 === 0) ready.push(byPath.get(dep) as Node);
    }
  }
  return rank;
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

  // Kahn (öncelik kuyruklu): hazır düğümlerden (kategori, risk, yol) önceliğiyle; döngüde en öncelikli kalan zorla seçilir.
  // İkili yığınla O((V + E) log V).
  const prod = [...nodes.values()].filter((n) => n.cat !== '6' && n.cat !== 'test');
  const rank = topoRank(prod);
  prod.sort((a, b) => CAT_ORDER[a.cat] - CAT_ORDER[b.cat] || (rank.get(a.file.path) ?? 0) - (rank.get(b.file.path) ?? 0));

  const steps: ReviewStep[] = [];
  const placed = new Set<string>();
  const push = (fileId: string, symbolIds: string[], reason: string) => {
    placed.add(fileId);
    steps.push({ order: steps.length + 1, fileId, symbolIds, reason });
  };
  const tests = [...nodes.values()].filter((n) => n.cat === 'test');
  const subjectOf = attachTests(tests, prod);

  const testsBySubject = new Map<string, Node[]>();
  for (const t of tests) {
    const subj = subjectOf.get(t.file.path);
    if (subj === undefined) continue;
    const list = testsBySubject.get(subj);
    if (list) list.push(t);
    else testsBySubject.set(subj, [t]);
  }
  for (const n of prod) {
    push(n.file.path, memberSymbolIds(n.tds), reasonFor(n, placed));
    for (const t of testsBySubject.get(n.file.path) ?? []) {
      if (placed.has(t.file.path)) continue;
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Test kodunda üretim düğümünün (değişen) tip adlarının geçme sayısı. */
function referenceCount(test: Node, prodNode: Node): number {
  const code = test.tds.map((td) => td.newFile ?? td.oldFile).find((m) => m !== undefined)?.normalizedCode ?? '';
  if (!code) return 0;
  const names = new Set(semanticTypes(prodNode.tds).map((td) => td.change.name));
  if (names.size === 0) for (const td of prodNode.tds) names.add(td.change.name);
  let n = 0;
  for (const name of names) n += code.match(new RegExp(`\\b${escapeRe(name)}\\b`, 'g'))?.length ?? 0;
  return n;
}

/**
 * Her testi okunacağı üretim dosyasına bağlar:
 *  1. ad kalıbı (FooTest → Foo),
 *  2. en uzun önek (BitMapExtractorFromLongArrayTest → BitMapExtractor; önekten sonra büyük harf/rakam),
 *  3. testi ilişkili sayan üretim dosyası tekse o; birden çoksa testte en çok referans verilen değişen tip (açık fark
 *     yoksa bağlanmaz — uydurma eşleşme yapılmaz; test, eşleşmeyen testler arasında listelenir).
 */
function attachTests(tests: readonly Node[], prod: readonly Node[]): Map<string, string> {
  const byStem = new Map<string, string>();
  for (const n of prod) byStem.set(basename(n.file.path).replace(/\.\w+$/, ''), n.file.path);
  const byPath = new Map(prod.map((n) => [n.file.path, n]));
  // test yolu → onu ilişkili sayan üretim dosyaları
  const related = new Map<string, string[]>();
  for (const n of prod) {
    for (const tp of n.file.relatedTestFiles) {
      const list = related.get(tp);
      if (list) list.push(n.file.path);
      else related.set(tp, [n.file.path]);
    }
  }
  const out = new Map<string, string>();
  for (const t of tests) {
    const stem = basename(t.file.path).replace(/\.\w+$/, '');
    const subject = TEST_STEM_RE.exec(stem)?.[1];
    const byName = subject ? byStem.get(subject) : undefined;
    if (byName) {
      out.set(t.file.path, byName);
      continue;
    }
    if (subject) {
      let best: string | undefined;
      for (const s of byStem.keys()) {
        if (s.length < 4 || s.length >= subject.length || !subject.startsWith(s) || !/[A-Z0-9_]/.test(subject[s.length])) continue;
        if (!best || s.length > best.length) best = s;
      }
      if (best) {
        out.set(t.file.path, byStem.get(best) as string);
        continue;
      }
    }
    const cands = related.get(t.file.path) ?? [];
    if (cands.length === 1) {
      out.set(t.file.path, cands[0]);
      continue;
    }
    if (cands.length > 1) {
      const scored = cands.map((p) => ({ p, n: referenceCount(t, byPath.get(p) as Node) })).sort((a, b) => b.n - a.n || a.p.localeCompare(b.p));
      if (scored[0].n > 0 && scored[0].n > (scored[1]?.n ?? 0)) out.set(t.file.path, scored[0].p);
    }
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
      if (n.tds.length > 0) reason = `Bağımlılık sırası: ${name} — ${summary}${depPhrase}`;
      else if (/(^|\/)(package-info|module-info)\.java$/.test(n.file.path)) {
        const top = [...n.file.risk.reasons].sort((a, b) => b.weight - a.weight)[0];
        reason = `Paket/modül bildirimi: ${basename(n.file.path)}${top ? ` — ${top.message}` : ''}`;
      } else reason = `İçerik analiz edilemedi; diff'i elle inceleyin`;
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

/**
 * ChangeSet → ReviewModel. Reviewist analiz motorunun giriş noktası.
 *
 * Akış: dosya iskeletleri → Java ayrıştırma (işçi havuzu + blob SHA önbelleği) + semantik diff + dosyalar arası taşıma →
 * çift FQN id'leri ('@kök') → repo indeksi (değişen Java yoksa atlanır) → zenginleştirme (kalıtım, çağıranlar, bayat
 * çağrılar) → import hedefi + kozmetik → katman → mimari → risk → test eşleme → gruplama → okuma planı → etki grafiği →
 * bulgular → (büyük diff'te değişmeyen üyeleri iskelete indirme) → özet.
 * Bir dosyanın analizi patlarsa review patlamaz: FileChange.parseError + warnings.
 */
import { randomUUID } from 'node:crypto';
import type { ChangeSet, ChangeSetFile, FileChange, Finding, ReviewModel, TypeChange } from '../shared/types.js';
import { detectCrossFileMoves, diffJavaFile, parseJavaFiles, RepoIndex } from './java/index.js';
import type { JavaFileModel, ParseItem, RepoIndexApi, TypeDiff } from './java/index.js';
import { checkArchitecture } from './analysis/architecture.js';
import type { AnalysisContext, AnalyzedFile } from './analysis/context.js';
import { cosmeticFindings, describeRetarget, importRetargets, isCosmeticJava, isWhitespaceOnly, type ImportRetarget } from './analysis/cosmetic.js';
import { createEmptyIndex } from './analysis/emptyIndex.js';
import { enrich, outsideCallerIds, registerSymbols } from './analysis/enrich.js';
import { computeSummary, fileFindings, memberFindings, sortFindings, typeFindings, unverifiedStaleFinding } from './analysis/findings.js';
import { buildGraph } from './analysis/graph.js';
import { buildGroups } from './analysis/grouping.js';
import { createModuleResolver, detectLanguage, detectLayer, isHexagonalRepo, isTestPath } from './analysis/layers.js';
import { buildReviewPlan } from './analysis/reviewPlan.js';
import { isBreakingSignature, isSemanticChange } from './analysis/risk.js';
import { assignLayers, scoreAll } from './analysis/scoring.js';
import { assignUniqueIds, sourceRootFor, type SymbolIds } from './analysis/symbolIds.js';
import { TestLocator, testFindings } from './analysis/testMapping.js';
import { changedLineSets, emptyRisk, errorMessage, mapLimit, progressCounter } from './analysis/util.js';

export interface BuildReviewOptions {
  id?: string; // verilmezse üretilir
  maxIndexFiles?: number; // repo indeksi için en fazla .java dosyası (varsayılan 5000)
  onProgress?: (msg: string) => void;
  /** Aşama süreleri (ms): readChanged, parseChanged, indexParse, indexBuild, enrich, riskAndTests, planGraphFindings, total. Ölçüm/log için. */
  onTimings?: (timings: Readonly<Record<string, number>>) => void;
  /**
   * (Tur 4) Analiz artefaktları hazır olunca (repo indeksi kurulduktan sonra, model dönmeden önce) çağrılır.
   * Kod gezinme uçları (outline/locate) için sunucu bunları saklar.
   */
  onArtifacts?: (artifacts: ReviewArtifacts) => void;
}

/**
 * (Tur 4) Review başına analiz artefaktları: kod gezinme (outline/locate) bunlarla ReviewModel id'leriyle aynı biçimde
 * id üretir. Modeller ayrıştırma önbelleğiyle paylaşılır: DEĞİŞTİRİLMEMELİDİR.
 */
export interface ReviewArtifacts {
  /** Head repo indeksi (indeks id'leri: '@kök' soneksiz). */
  index: RepoIndexApi;
  /** Değişen Java dosyalarının head modelleri (yeni yol → model). */
  newFiles: ReadonlyMap<string, JavaFileModel>;
  /** Değişen Java dosyalarının base modelleri (eski yol → model). */
  oldFiles: ReadonlyMap<string, JavaFileModel>;
  /** Model id ↔ indeks id (B3 '@kök' soneki). */
  ids: SymbolIds;
}

export type { SymbolIds };

const READ_CONCURRENCY = 16;
/** Diff dışı dosyalar: kaynak (git cat-file vb.) G/Ç'si baskın olduğundan daha yüksek eşzamanlılık. */
const INDEX_READ_CONCURRENCY = 32;
const DEFAULT_MAX_INDEX_FILES = 5000;
/** Bu sayıdan çok değişen Java dosyasında değişmeyen üyeler yalnız iskelet bilgisiyle tutulur (model boyutu). */
export const SLIM_MEMBERS_FILE_LIMIT = 400;

function skeleton(csf: ChangeSetFile, moduleOf: (p: string) => string | undefined): FileChange {
  const file: FileChange = {
    id: csf.path,
    path: csf.path,
    status: csf.status,
    language: detectLanguage(csf.path),
    binary: csf.binary,
    additions: csf.additions,
    deletions: csf.deletions,
    hunks: csf.hunks,
    layer: 'other',
    isTest: isTestPath(csf.path),
    cosmeticOnly: false,
    typeIds: [],
    relatedTestFiles: [],
    risk: emptyRisk(),
    reviewOrder: 0,
  };
  if (csf.oldPath !== undefined) file.oldPath = csf.oldPath;
  const mod = moduleOf(csf.path);
  if (mod !== undefined) file.module = mod;
  return file;
}

async function safeList(cs: ChangeSet, ext: string | undefined, warnings: string[]): Promise<string[]> {
  try {
    return await cs.listFiles('new', ext);
  } catch (error) {
    warnings.push(`Repo dosya listesi alınamadı (${errorMessage(error)}); yalnızca değişen dosyalar kullanıldı`);
    return [];
  }
}

async function safeRead(cs: ChangeSet, side: 'old' | 'new', path: string): Promise<string | undefined> {
  try {
    return await cs.readFile(side, path);
  } catch {
    return undefined;
  }
}

/** Hunk başlıklarından (@@ ... @@ sonrası bağlam) metot adlarını çıkarır. */
function methodsFromHunkHeaders(csf: ChangeSetFile): string[] {
  const names = new Set<string>();
  for (const h of csf.hunks) {
    const m = /(\w+)\s*\([^)]*\)?\s*(?:throws [\w.,\s]+)?\{?\s*$/.exec(h.header.trim());
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return'].includes(m[1])) names.add(m[1]);
  }
  return [...names];
}

function parseErrorText(model: JavaFileModel): string {
  const lines = model.errorLines.slice(0, 5).join(', ');
  return `Ayrıştırma hatası (satır ${lines}${model.errorLines.length > 5 ? ' ...' : ''})`;
}

/** Ayrıştırma sonucu: model ya da (yalnız bu dosyaya ait) hata. */
type Parsed = JavaFileModel | Error;

/** Ayrıştırma sonucunu dosyaya işler: hata/kısmi ayrıştırma uyarısı; model ya da undefined döner. */
function acceptParsed(af: AnalyzedFile, side: 'old' | 'new', result: Parsed | undefined, warnings: string[]): JavaFileModel | undefined {
  if (result === undefined) return undefined;
  if (result instanceof Error) {
    const text = `${side === 'old' ? 'Eski sürüm ayrıştırılamadı' : 'Ayrıştırılamadı'}: ${errorMessage(result)}`;
    af.file.parseError = af.file.parseError ? `${af.file.parseError}; ${text}` : text;
    warnings.push(`${af.file.path}: ${text}`);
    return undefined;
  }
  if (result.hasErrors && result.errorLines.length > 0) {
    const text = `${side === 'old' ? 'Eski sürüm: ' : ''}${parseErrorText(result)}`;
    af.file.parseError = af.file.parseError ? `${af.file.parseError}; ${text}` : text;
    warnings.push(`${af.file.path}: ${text}; analiz kısmi olabilir`);
  }
  return result;
}

async function safeBlobId(cs: ChangeSet, side: 'old' | 'new', path: string): Promise<string | undefined> {
  if (!cs.blobId) return undefined;
  try {
    return await cs.blobId(side, path);
  } catch {
    return undefined;
  }
}

/**
 * Dosyaları işçi havuzu + blob SHA önbelleğiyle ayrıştırır (A1 parseJavaFiles). Havuz tek dosyanın hatasında tüm çağrıyı
 * düşürdüğünden, hata olursa dosya dosya yeniden denenir; böylece yalnız sorunlu dosya Error olarak döner.
 */
async function parseAll(items: ParseItem[], onProgress?: (done: number, total: number) => void): Promise<Parsed[]> {
  if (items.length === 0) return [];
  try {
    return await parseJavaFiles(items, { onProgress });
  } catch {
    const out: Parsed[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        out.push((await parseJavaFiles([items[i]]))[0]);
      } catch (error) {
        out.push(error instanceof Error ? error : new Error(String(error)));
      }
      onProgress?.(i + 1, items.length);
    }
    return out;
  }
}

interface JavaSources {
  oldSrc?: string;
  newSrc?: string;
  oldKey?: string;
  newKey?: string;
}

/** Değişen Java dosyasının iki tarafını (ve varsa blob kimliklerini) okur (G/Ç; eşzamanlı çalıştırılır). */
async function readJavaSources(cs: ChangeSet, af: AnalyzedFile): Promise<JavaSources> {
  const csf = af.cs;
  const oldPath = csf.oldPath ?? csf.path;
  const needOld = csf.status !== 'added';
  const needNew = csf.status !== 'deleted';
  const [oldSrc, newSrc, oldKey, newKey] = await Promise.all([
    needOld ? safeRead(cs, 'old', oldPath) : undefined,
    needNew ? safeRead(cs, 'new', csf.path) : undefined,
    needOld ? safeBlobId(cs, 'old', oldPath) : undefined,
    needNew ? safeBlobId(cs, 'new', csf.path) : undefined,
  ]);
  return { oldSrc, newSrc, oldKey, newKey };
}

/** İçeriği alınamayan dosya: yalnız diff gösterilir. true dönerse dosya analiz edilemez. */
function missingSources(af: AnalyzedFile, src: JavaSources, warnings: string[]): boolean {
  const csf = af.cs;
  const needOld = csf.status !== 'added';
  const needNew = csf.status !== 'deleted';
  if ((needOld && src.oldSrc === undefined) || (needNew && src.newSrc === undefined)) {
    af.unanalyzed = true;
    const methods = methodsFromHunkHeaders(csf);
    warnings.push(
      `${csf.path}: dosya içeriği alınamadı; Java analizi yapılamadı, yalnızca diff gösteriliyor${methods.length ? ` (hunk başlıklarındaki metotlar: ${methods.join(', ')})` : ''}`,
    );
    return true;
  }
  return false;
}

/** Ayrıştırılmış iki tarafı işler ve semantik diff'i çıkarır. */
function analyzeJavaFile(af: AnalyzedFile, oldParsed: Parsed | undefined, newParsed: Parsed | undefined, warnings: string[]): void {
  const csf = af.cs;
  const oldPath = csf.oldPath ?? csf.path;
  const needOld = csf.status !== 'added';
  const needNew = csf.status !== 'deleted';
  af.oldModel = acceptParsed(af, 'old', oldParsed, warnings);
  af.newModel = acceptParsed(af, 'new', newParsed, warnings);
  if ((needOld && !af.oldModel) || (needNew && !af.newModel)) {
    af.unanalyzed = true;
    return;
  }
  try {
    // B7: git'in yeniden adlandırma dediği dosyada tek üst düzey tip eşiğe bakılmadan 'renamed' eşlenir (A1 seçeneği).
    af.typeDiffs = diffJavaFile(af.oldModel, af.newModel, { oldPath, newPath: csf.path, fileRenamed: csf.status === 'renamed' });
    for (const td of af.typeDiffs) td.change.file = csf.path;
  } catch (error) {
    af.unanalyzed = true;
    af.typeDiffs = [];
    af.file.parseError = `Semantik diff başarısız: ${errorMessage(error)}`;
    warnings.push(`${csf.path}: semantik diff başarısız (${errorMessage(error)})`);
  }
}

/** Liste: ilk 10 dosya adı (yol), fazlası '... ve N dosya daha'. */
function fileList(paths: readonly string[], max = 10): string {
  const sorted = [...paths].sort();
  return `${sorted.slice(0, max).join(', ')}${sorted.length > max ? ` ... ve ${sorted.length - max} dosya daha` : ''}`;
}

/** İndekste okunamayan/ayrıştırılamayan ve ayrıştırma hatası (ERROR düğümü) içeren dosyalar için tek uyarı. */
export function pushIndexProblems(warnings: string[], failed: readonly string[], withErrors: readonly string[]): void {
  const total = failed.length + withErrors.length;
  if (total === 0) return;
  const parts: string[] = [];
  if (failed.length) parts.push(`okunamayan/ayrıştırılamayan ${failed.length} dosya: ${fileList(failed)}`);
  if (withErrors.length) parts.push(`ayrıştırma hatası içeren ${withErrors.length} dosya: ${fileList(withErrors)}`);
  warnings.push(`Repo indeksinde ${total} dosya okunamadı/ayrıştırılamadı (${parts.join('; ')}); bu dosyalardaki çağıranlar görünmeyebilir veya eksik olabilir`);
}

/**
 * Repo indeksi. Değişen dosyaların head modeli (adım 2'de ayrıştırılmış) yeniden okunmaz/ayrıştırılmaz; yalnızca
 * diff dışındaki .java dosyaları okunur. Okuma eşzamanlı; ayrıştırma işçi havuzunda, blob kimliği varsa önbellekten.
 */
async function buildIndex(
  cs: ChangeSet,
  changed: AnalyzedFile[],
  maxFiles: number,
  warnings: string[],
  progress: (m: string) => void,
  timings: Record<string, number>,
): Promise<{ index: RepoIndexApi; javaPaths: string[] }> {
  const changedModels = new Map<string, JavaFileModel>();
  // Analiz edilemeyen (içerik/ayrıştırma sorunu) değişen dosyalar da indeks için tekrar okunmaz: aynı sonuç alınır.
  const skip = new Set<string>();
  for (const af of changed) {
    skip.add(af.file.path);
    if (af.newModel) changedModels.set(af.file.path, af.newModel);
  }
  const javaPaths = await safeList(cs, '.java', warnings);
  const others = javaPaths.filter((p) => !skip.has(p));
  const budget = Math.max(0, maxFiles - changedModels.size);
  if (others.length > budget) {
    warnings.push(`Repo indeksi ${maxFiles} dosya ile sınırlandı (repoda ${javaPaths.length} .java dosyası var); çağıran/alt sınıf bilgisi eksik olabilir`);
  }
  const toRead = others.slice(0, budget);
  const total = changedModels.size + toRead.length;
  const counter = progressCounter(progress, total, (d, t) => `Repo indeksi: ${d}/${t} dosya`, changedModels.size);
  const failed: string[] = [];
  const tRead = performance.now();
  // 1) Okuma (G/Ç, yüksek eşzamanlılık) + blob kimliği (önbellek anahtarı)
  const read = await mapLimit(toRead, INDEX_READ_CONCURRENCY, async (p) => {
    const [src, key] = await Promise.all([safeRead(cs, 'new', p), safeBlobId(cs, 'new', p)]);
    if (src === undefined) failed.push(p);
    return src === undefined ? undefined : { path: p, source: src, cacheKey: key };
  });
  timings.indexRead = performance.now() - tRead;
  // 2) Ayrıştırma (işçi havuzu + önbellek)
  const items: ParseItem[] = [];
  for (const x of read) if (x) items.push(x.cacheKey ? { path: x.path, source: x.source, cacheKey: x.cacheKey } : { path: x.path, source: x.source });
  const t0 = performance.now();
  let reported = 0;
  const results = await parseAll(items, (done) => {
    for (; reported < done; reported++) counter.tick();
  });
  for (; reported < toRead.length; reported++) counter.tick();
  timings.indexParse = performance.now() - t0;
  const parsed: JavaFileModel[] = [];
  results.forEach((r, i) => {
    if (r instanceof Error) failed.push(items[i].path);
    else parsed.push(r);
  });
  const models = [...changedModels.values(), ...parsed];
  pushIndexProblems(warnings, failed, parsed.filter((m) => m.hasErrors).map((m) => m.path));
  progress(`Çağrı grafiği kuruluyor (${models.length} dosya)`);
  const t1 = performance.now();
  try {
    return { index: RepoIndex.build(models), javaPaths };
  } catch (error) {
    warnings.push(`Repo indeksi kurulamadı (${errorMessage(error)}); çağıran ve kalıtım bilgisi yok`);
    return { index: createEmptyIndex(models), javaPaths };
  } finally {
    timings.indexBuild = performance.now() - t1;
  }
}

interface Structure {
  files: AnalyzedFile[];
  byPath: Map<string, AnalyzedFile>;
  javaFiles: AnalyzedFile[];
  allDiffs: TypeDiff[];
  ids: SymbolIds;
  index: RepoIndexApi;
  changedPaths: string[];
  repoFiles: string[];
  repoFilesKnown: boolean;
  hexagonal: boolean;
}

/** Adım 1-3: iskeletler, değişen Java dosyalarının ayrıştırılması + semantik diff, '@kök' id'leri, repo indeksi. */
async function analyzeStructure(
  cs: ChangeSet,
  maxIndexFiles: number,
  warnings: string[],
  progress: (msg: string) => void,
  timings: Record<string, number>,
): Promise<Structure> {
  // 1. İskeletler
  progress(`Değişiklik kümesi hazırlanıyor (${cs.files.length} dosya)`);
  const listed = await safeList(cs, undefined, warnings);
  const repoFilesKnown = listed.length > 0;
  const changedPaths = cs.files.map((f) => f.path);
  const repoFiles = repoFilesKnown ? listed : cs.files.filter((f) => f.status !== 'deleted').map((f) => f.path);
  if (!repoFilesKnown) warnings.push('Kaynak repo dosya listesi vermiyor; çağıran, alt sınıf ve test eşlemesi yalnızca değişen dosyalarla yapıldı');
  const moduleOf = createModuleResolver([...repoFiles, ...changedPaths]);
  const hexagonal = isHexagonalRepo([...repoFiles, ...changedPaths]);
  const files: AnalyzedFile[] = cs.files.map((csf) => {
    const { added, removed } = changedLineSets(csf.hunks);
    return { file: skeleton(csf, moduleOf), cs: csf, typeDiffs: [], addedLines: added, removedLines: removed, unanalyzed: false };
  });
  const byPath = new Map(files.map((af) => [af.file.path, af]));

  // 2. Değişen Java dosyalarını oku (eşzamanlı) + ayrıştır (işçi havuzu, blob SHA önbelleği) + semantik diff
  const javaFiles = files.filter((af) => af.file.language === 'java' && !af.file.binary);
  const tRead = performance.now();
  const readCounter = progressCounter(progress, javaFiles.length, (d, t) => `Değişen dosyalar okunuyor (${d}/${t})`);
  const sources = await mapLimit(javaFiles, READ_CONCURRENCY, async (af) => {
    try {
      return await readJavaSources(cs, af);
    } finally {
      readCounter.tick();
    }
  });
  timings.readChanged = performance.now() - tRead;
  const tParse = performance.now();
  const parseCounter = progressCounter(progress, javaFiles.length, (d, t) => `Java ayrıştırılıyor (${d}/${t} dosya)`);
  // Eski + yeni taraflar tek havuz çağrısında ayrıştırılır; slots[i] = [eski öğe indeksi, yeni öğe indeksi]
  const items: ParseItem[] = [];
  const slots: [number | undefined, number | undefined][] = javaFiles.map((af, i) => {
    const src = sources[i];
    if (missingSources(af, src, warnings)) return [undefined, undefined];
    const oldPath = af.cs.oldPath ?? af.cs.path;
    const push = (path: string, source: string | undefined, key: string | undefined) => {
      if (source === undefined) return undefined;
      items.push(key ? { path, source, cacheKey: key } : { path, source });
      return items.length - 1;
    };
    return [push(oldPath, src.oldSrc, src.oldKey), push(af.cs.path, src.newSrc, src.newKey)];
  });
  let ticked = 0;
  const parsedItems = await parseAll(items, (done, total) => {
    const target = Math.floor((done / total) * javaFiles.length);
    for (; ticked < target; ticked++) parseCounter.tick();
  });
  for (; ticked < javaFiles.length; ticked++) parseCounter.tick();
  for (let i = 0; i < javaFiles.length; i++) {
    const af = javaFiles[i];
    if (af.unanalyzed) continue;
    const [o, n] = slots[i];
    try {
      analyzeJavaFile(af, o === undefined ? undefined : parsedItems[o], n === undefined ? undefined : parsedItems[n], warnings);
    } catch (error) {
      af.unanalyzed = true;
      af.typeDiffs = [];
      af.file.parseError = `Analiz başarısız: ${errorMessage(error)}`;
      warnings.push(`${af.file.path}: analiz başarısız (${errorMessage(error)})`);
    }
  }
  timings.parseChanged = performance.now() - tParse;
  const allDiffs = javaFiles.flatMap((af) => af.typeDiffs);
  try {
    detectCrossFileMoves(allDiffs);
  } catch (error) {
    warnings.push(`Dosyalar arası taşıma tespiti başarısız (${errorMessage(error)})`);
  }
  // B3: aynı FQN farklı kaynak köklerindeki dosyalardan geliyorsa model id'leri '@kök' ile ayrılır.
  let rootLookup: (path: string) => string | undefined = (path) => {
    const model = byPath.get(path)?.newModel;
    return model ? sourceRootFor(path, model.packageName) : undefined;
  };
  const ids = assignUniqueIds(allDiffs, (path) => rootLookup(path));
  for (const af of javaFiles) {
    const pkg = (af.newModel ?? af.oldModel)?.packageName;
    if (pkg) af.file.packageName = pkg;
    af.file.typeIds = [...new Set(af.typeDiffs.map((td) => td.change.id))];
  }

  // 3. Repo indeksi (değişen Java dosyası yoksa atlanır: çağıran/alt tip sorgusu gerekmez)
  const { index } =
    javaFiles.length > 0
      ? await buildIndex(cs, javaFiles, maxIndexFiles, warnings, progress, timings)
      : { index: createEmptyIndex([]) };
  rootLookup = (path) => {
    const model = index.files.get(path) ?? byPath.get(path)?.newModel;
    return model ? sourceRootFor(path, model.packageName) : undefined;
  };

  return { files, byPath, javaFiles, allDiffs, ids, index, changedPaths, repoFiles, repoFilesKnown, hexagonal };
}

function artifactsOf(st: Structure): ReviewArtifacts {
  const newFiles = new Map<string, JavaFileModel>();
  const oldFiles = new Map<string, JavaFileModel>();
  for (const af of st.javaFiles) {
    if (af.newModel) newFiles.set(af.file.path, af.newModel);
    if (af.oldModel) oldFiles.set(af.cs.oldPath ?? af.cs.path, af.oldModel);
  }
  return { index: st.index, newFiles, oldFiles, ids: st.ids };
}

/**
 * (Tur 4) Yalnız artefaktları kurar (ReviewModel üretmeden): bellekten düşmüş bir review için outline/locate
 * istendiğinde. Ayrıştırma blob SHA önbelleğinden geldiğinden tam analizden ucuzdur; id'ler aynı ChangeSet için
 * buildReview ile aynıdır (aynı maxIndexFiles verilmelidir).
 */
export async function buildArtifacts(
  cs: ChangeSet,
  opts: Pick<BuildReviewOptions, 'maxIndexFiles' | 'onProgress'> = {},
): Promise<ReviewArtifacts> {
  const st = await analyzeStructure(cs, opts.maxIndexFiles ?? DEFAULT_MAX_INDEX_FILES, [], opts.onProgress ?? (() => undefined), {});
  return artifactsOf(st);
}

export async function buildReview(cs: ChangeSet, opts: BuildReviewOptions = {}): Promise<ReviewModel> {
  const progress = opts.onProgress ?? (() => undefined);
  const warnings: string[] = [];
  const maxIndexFiles = opts.maxIndexFiles ?? DEFAULT_MAX_INDEX_FILES;
  const tStart = performance.now();
  const timings: Record<string, number> = {};
  const st = await analyzeStructure(cs, maxIndexFiles, warnings, progress, timings);
  const { files, byPath, javaFiles, allDiffs, ids, index, changedPaths, repoFiles, repoFilesKnown, hexagonal } = st;
  opts.onArtifacts?.(artifactsOf(st));

  const ctx: AnalysisContext = {
    files,
    byPath,
    typeDiffs: allDiffs,
    index,
    hexagonal,
    repoFiles,
    repoFilesKnown,
    members: new Map(),
    types: new Map(),
    staleCalls: new Map(),
    unverifiedStaleCalls: new Map(),
    brokenOverrides: new Map(),
    orphanedOverrides: new Map(),
    staleTypeRefs: new Map(),
    architecture: new Map(),
    importRetargets: new Map(),
    ids,
    warnings,
  };

  // 4. Zenginleştirme
  const tEnrich = performance.now();
  registerSymbols(ctx);
  enrich(ctx);
  timings.enrich = performance.now() - tEnrich;

  // 5. Kozmetik + katman + risk
  progress('Risk ve mimari analiz');
  const tRisk = performance.now();
  for (const af of files) {
    try {
      if (af.file.language === 'java' && !af.unanalyzed && af.oldModel && af.newModel) applyImportRetargets(ctx, af, importRetargets(af.oldModel, af.newModel));
    } catch (error) {
      warnings.push(`${af.file.path}: import hedefi karşılaştırılamadı (${errorMessage(error)})`);
    }
    try {
      if (af.file.language === 'java' && !af.unanalyzed) {
        af.file.cosmeticOnly = af.cs.status !== 'added' && af.cs.status !== 'deleted' && isCosmeticJava(af.cs.status, af.oldModel, af.newModel, af.typeDiffs);
      } else if (!af.file.binary && (af.cs.status === 'modified' || af.cs.status === 'renamed')) {
        af.file.cosmeticOnly = isWhitespaceOnly(af.cs.hunks);
      }
    } catch (error) {
      warnings.push(`${af.file.path}: kozmetik tespiti başarısız (${errorMessage(error)})`);
    }
  }
  assignLayers(ctx);
  // 5b. Mimari (risk katkısı için skordan önce)
  const findings: Finding[] = [];
  for (const af of files) {
    if (af.file.isTest || !af.newModel) continue;
    try {
      const arch = checkArchitecture(af.file.path, af.newModel, af.oldModel, af.cs.oldPath, {
        hexagonal,
        resolve: (name, file, type) => index.resolveTypeName(name, file, type),
        getType: (fqn) => index.getType(fqn),
        pathOfType: (fqn) => index.getFileOfType(fqn)?.path,
      });
      for (const f of arch) {
        // Yalnız biçim değişikliği olan dosyada "önceden de vardı" bilgileri gürültüdür.
        if (af.file.cosmeticOnly && f.severity === 'info') continue;
        if (f.symbolIds) f.symbolIds = f.symbolIds.map((id) => ids.toModel(id, af.file.path));
        findings.push(f);
      }
    } catch (error) {
      warnings.push(`${af.file.path}: mimari kontroller çalıştırılamadı (${errorMessage(error)})`);
    }
  }
  for (const f of findings) {
    if (f.severity === 'info' || !f.symbolIds?.length) continue;
    const id = f.symbolIds[0];
    const list = ctx.architecture.get(id) ?? [];
    list.push({ severity: f.severity === 'error' ? 'error' : 'warning', title: f.title });
    ctx.architecture.set(id, list);
  }

  for (const af of files) {
    try {
      scoreAll({ ...ctx, files: [af] });
    } catch (error) {
      warnings.push(`${af.file.path}: risk hesaplanamadı (${errorMessage(error)})`);
    }
  }

  // 6. Test eşleme
  progress('Testler eşleniyor');
  const locator = new TestLocator(repoFiles, (fqn) => index.filesReferencingType(ids.toIndex(fqn)));
  const primaryTests = new Map<string, string[]>();
  for (const af of files) {
    if (af.file.isTest || af.file.language !== 'java' || af.cs.status === 'deleted') continue;
    const top = af.typeDiffs.filter((td) => td.newType && !td.newType.outerFqn).map((td) => ({ fqn: td.change.id, name: td.change.name }));
    if (!top.length) continue;
    const found = locator.findDetailed(af.file.path, top);
    af.file.relatedTestFiles = [...new Set([...found.byName, ...found.byReference])].sort();
    primaryTests.set(af.file.path, found.byName);
  }
  const changedSet = new Set(changedPaths);
  const tests = testFindings(
    files.map((af) => ({ file: af.file, typeDiffs: af.typeDiffs, primaryTests: primaryTests.get(af.file.path) })),
    changedSet,
    repoFilesKnown,
  );
  findings.push(...tests.findings);

  // 8. Gruplama, plan, graf
  timings.riskAndTests = performance.now() - tRisk;
  progress('Okuma planı, gruplar ve etki grafiği hazırlanıyor');
  const tPlan = performance.now();
  const types = uniqueTypes(allDiffs);
  const fileChanges = files.map((af) => af.file);
  const groups = buildGroups(allDiffs, fileChanges, ctx.staleCalls);
  const reviewPlan = buildReviewPlan(fileChanges, new Map(files.map((af) => [af.file.path, af.typeDiffs])));
  const graphResult = buildGraph({
    typeDiffs: allDiffs,
    files: fileChanges,
    index,
    staleCalls: ctx.staleCalls,
    toIndexId: ids.toIndex,
    layerOf: (path, fqn) => {
      const t = fqn ? index.getType(fqn) : undefined;
      const f = fqn ? index.getFileOfType(fqn) : undefined;
      return detectLayer({
        path: path ?? f?.path ?? '',
        packageName: f?.packageName,
        annotations: t?.annotations,
        superTypes: t ? [...(t.superclass ? [t.superclass] : []), ...t.interfaces] : undefined,
        typeKind: t?.kind,
        typeName: t?.name,
        hexagonal,
      });
    },
  });
  if (graphResult.truncatedFrom) {
    warnings.push(`Etki grafiği ${graphResult.truncatedFrom} düğümden ${graphResult.graph.nodes.length} düğüme kırpıldı (en riskliler tutuldu)`);
  }

  // 9. Bulgular
  const contractChanged = new Set(
    allDiffs.flatMap((td) => td.members).filter((m) => isBreakingSignature(m.change) || m.change.status === 'removed' || m.change.status === 'renamed' || m.change.status === 'added').map((m) => m.change.id),
  );
  for (const af of files) {
    for (const td of af.typeDiffs) {
      for (const md of td.members) {
        const mc = md.change;
        if (!isSemanticChange(mc.status)) continue;
        findings.push(
          ...memberFindings({
            mc,
            owner: td.change,
            file: af.file,
            staleCalls: ctx.staleCalls.get(mc.id) ?? [],
            outsideCallers: outsideCallerIds(ctx, mc.callers, 'exact').length,
            followsChangedContract: mc.overrides.some((o) => contractChanged.has(o)),
          }),
        );
      }
      findings.push(...typeFindings(td.change, af.file));
    }
    findings.push(...fileFindings(af.file));
  }
  const semanticMembers = allDiffs.flatMap((td) => td.members).filter((m) => m.change.status !== 'unchanged');
  findings.push(
    ...cosmeticFindings({
      files: files.length,
      cosmeticFiles: fileChanges.filter((f) => f.cosmeticOnly).map((f) => f.path),
      changedMembers: semanticMembers.length,
      cosmeticMembers: semanticMembers.filter((m) => m.change.status === 'cosmetic').length,
    }),
  );

  findings.push(...unverifiedStaleFinding(ctx.unverifiedStaleCalls));
  if (javaFiles.length > SLIM_MEMBERS_FILE_LIMIT) slimUnchangedMembers(types);

  const summary = computeSummary(fileChanges, types, graphResult.impactedOutsideDiff, tests.untested);
  timings.planGraphFindings = performance.now() - tPlan;
  timings.total = performance.now() - tStart;
  opts.onTimings?.(timings);
  progress(`Analiz tamamlandı (${files.length} dosya, ${types.length} tip, ${(timings.total / 1000).toFixed(1)} sn)`);
  return {
    id: opts.id ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    source: cs.info,
    summary,
    files: fileChanges,
    types,
    graph: graphResult.graph,
    groups,
    reviewPlan,
    findings: sortFindings(findings),
    warnings,
  };
}

/**
 * B5: aynı basit adın import hedefi değiştiyse (javax → jakarta) adı kullanan tiplere ayrıntı eklenir; değişmemiş/kozmetik
 * görünen tip 'modified' sayılır (anlam değişti) ve risk için ctx.importRetargets doldurulur.
 */
function applyImportRetargets(ctx: AnalysisContext, af: AnalyzedFile, retargets: readonly ImportRetarget[]): void {
  if (retargets.length === 0) return;
  const top = af.typeDiffs.filter((td) => td.newType && !td.newType.outerFqn);
  const uses = (td: TypeDiff, r: ImportRetarget) => r.name === '*' || new RegExp(`\\b${r.name.replace(/\$/g, '\\$')}\\b`).test(td.newType?.normalizedText ?? '');
  for (const td of af.typeDiffs) {
    if (!td.newType) continue;
    const mine = retargets.filter((r) => uses(td, r));
    if (mine.length === 0) continue;
    // İç tiplerde ayrıca işaretlenmez; dış tip (ya da kullanan üst düzey tip) yeterli.
    if (td.newType.outerFqn && top.some((t) => mine.every((r) => uses(t, r)))) continue;
    for (const r of mine) {
      const d = describeRetarget(r);
      if (!td.change.details.includes(d)) td.change.details.push(d);
    }
    if (td.change.status === 'unchanged' || td.change.status === 'cosmetic') td.change.status = 'modified';
    ctx.importRetargets.set(td.change.id, mine);
  }
  // Hiçbir tipte basit ad bulunamadıysa (ör. yalnız javadoc'ta) ana tip üzerinden raporlanır.
  if (!retargets.some((r) => af.typeDiffs.some((td) => ctx.importRetargets.get(td.change.id)?.includes(r))) && top[0]) {
    const td = top[0];
    for (const r of retargets) {
      const d = describeRetarget(r);
      if (!td.change.details.includes(d)) td.change.details.push(d);
    }
    if (td.change.status === 'unchanged' || td.change.status === 'cosmetic') td.change.status = 'modified';
    ctx.importRetargets.set(td.change.id, [...retargets]);
  }
}

/**
 * Büyük diff'te değişmeyen üyeler iskelet olarak kalır ("değişmeyenleri göster" görünümü için ad/imza/aralık yeter):
 * details/flags/callers/callees/overrides/overriddenBy boşaltılır.
 */
function slimUnchangedMembers(types: readonly TypeChange[]): void {
  for (const t of types) {
    for (const m of t.members) {
      if (m.status !== 'unchanged') continue;
      m.details = [];
      m.flags = [];
      m.callers = [];
      m.callees = [];
      m.overrides = [];
      m.overriddenBy = [];
      delete m.oldSignature;
      delete m.oldRange;
    }
  }
}

/** Aynı id'li tip iki kez gelirse (ör. tespit edilmemiş taşıma) head tarafı tutulur. */
function uniqueTypes(diffs: readonly TypeDiff[]): TypeChange[] {
  const byId = new Map<string, TypeDiff>();
  for (const td of diffs) {
    const prev = byId.get(td.change.id);
    if (!prev || (!prev.newType && td.newType)) byId.set(td.change.id, td);
  }
  return [...byId.values()].map((td) => td.change);
}

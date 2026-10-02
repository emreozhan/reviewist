/**
 * ChangeSet → ReviewModel. Reviewist analiz motorunun giriş noktası.
 *
 * Akış: dosya iskeletleri → Java ayrıştırma + semantik diff + dosyalar arası taşıma → repo indeksi →
 * zenginleştirme (kalıtım, çağıranlar, eski adla çağrılar) → kozmetik → katman → risk → test eşleme →
 * mimari → gruplama → okuma planı → etki grafiği → bulgular → özet.
 * Bir dosyanın analizi patlarsa review patlamaz: FileChange.parseError + warnings.
 */
import { randomUUID } from 'node:crypto';
import type { ChangeSet, ChangeSetFile, FileChange, Finding, ReviewModel, TypeChange } from '../shared/types.js';
import { detectCrossFileMoves, diffJavaFile, parseJavaFile, RepoIndex } from './java/index.js';
import type { JavaFileModel, RepoIndexApi, TypeDiff } from './java/model.js';
import { checkArchitecture } from './analysis/architecture.js';
import type { AnalysisContext, AnalyzedFile } from './analysis/context.js';
import { cosmeticFindings, isCosmeticJava, isWhitespaceOnly } from './analysis/cosmetic.js';
import { createEmptyIndex } from './analysis/emptyIndex.js';
import { enrich, outsideCallerIds, registerSymbols } from './analysis/enrich.js';
import { computeSummary, fileFindings, memberFindings, sortFindings, typeFindings } from './analysis/findings.js';
import { buildGraph } from './analysis/graph.js';
import { buildGroups } from './analysis/grouping.js';
import { createModuleResolver, detectLanguage, detectLayer, isHexagonalRepo, isTestPath } from './analysis/layers.js';
import { buildReviewPlan } from './analysis/reviewPlan.js';
import { isBreakingSignature, isSemanticChange } from './analysis/risk.js';
import { assignLayers, scoreAll } from './analysis/scoring.js';
import { TestLocator, testFindings } from './analysis/testMapping.js';
import { changedLineSets, emptyRisk, errorMessage, mapLimit, progressCounter } from './analysis/util.js';

export interface BuildReviewOptions {
  id?: string; // verilmezse üretilir
  maxIndexFiles?: number; // repo indeksi için en fazla .java dosyası (varsayılan 5000)
  onProgress?: (msg: string) => void;
  /** Aşama süreleri (ms): readChanged, parseChanged, indexParse, indexBuild, enrich, riskAndTests, planGraphFindings, total. Ölçüm/log için. */
  onTimings?: (timings: Readonly<Record<string, number>>) => void;
}

const READ_CONCURRENCY = 16;
/** Diff dışı dosyalar: kaynak (git cat-file vb.) G/Ç'si baskın olduğundan daha yüksek eşzamanlılık. */
const INDEX_READ_CONCURRENCY = 32;
const DEFAULT_MAX_INDEX_FILES = 5000;

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

async function parseSide(af: AnalyzedFile, side: 'old' | 'new', path: string, source: string, warnings: string[]): Promise<JavaFileModel | undefined> {
  try {
    const model = await parseJavaFile(path, source);
    if (model.hasErrors && model.errorLines.length > 0) {
      const text = `${side === 'old' ? 'Eski sürüm: ' : ''}${parseErrorText(model)}`;
      af.file.parseError = af.file.parseError ? `${af.file.parseError}; ${text}` : text;
      warnings.push(`${af.file.path}: ${text}; analiz kısmi olabilir`);
    }
    return model;
  } catch (error) {
    const text = `${side === 'old' ? 'Eski sürüm ayrıştırılamadı' : 'Ayrıştırılamadı'}: ${errorMessage(error)}`;
    af.file.parseError = af.file.parseError ? `${af.file.parseError}; ${text}` : text;
    warnings.push(`${af.file.path}: ${text}`);
    return undefined;
  }
}

interface JavaSources {
  oldSrc?: string;
  newSrc?: string;
}

/** Değişen Java dosyasının iki tarafını okur (G/Ç; eşzamanlı çalıştırılır). */
async function readJavaSources(cs: ChangeSet, af: AnalyzedFile): Promise<JavaSources> {
  const csf = af.cs;
  const oldPath = csf.oldPath ?? csf.path;
  const [oldSrc, newSrc] = await Promise.all([
    csf.status !== 'added' ? safeRead(cs, 'old', oldPath) : undefined,
    csf.status !== 'deleted' ? safeRead(cs, 'new', csf.path) : undefined,
  ]);
  return { oldSrc, newSrc };
}

/** Okunmuş kaynakları ayrıştırır ve semantik diff'i çıkarır (CPU; sırayla çalıştırılır). */
async function analyzeJavaFile(af: AnalyzedFile, src: JavaSources, warnings: string[]): Promise<void> {
  const csf = af.cs;
  const oldPath = csf.oldPath ?? csf.path;
  const needOld = csf.status !== 'added';
  const needNew = csf.status !== 'deleted';
  const { oldSrc, newSrc } = src;
  if ((needOld && oldSrc === undefined) || (needNew && newSrc === undefined)) {
    af.unanalyzed = true;
    const methods = methodsFromHunkHeaders(csf);
    warnings.push(
      `${csf.path}: dosya içeriği alınamadı; Java analizi yapılamadı, yalnızca diff gösteriliyor${methods.length ? ` (hunk başlıklarındaki metotlar: ${methods.join(', ')})` : ''}`,
    );
    return;
  }
  if (oldSrc !== undefined) af.oldModel = await parseSide(af, 'old', oldPath, oldSrc, warnings);
  if (newSrc !== undefined) af.newModel = await parseSide(af, 'new', csf.path, newSrc, warnings);
  if ((needOld && !af.oldModel) || (needNew && !af.newModel)) {
    af.unanalyzed = true;
    return;
  }
  try {
    af.typeDiffs = diffJavaFile(af.oldModel, af.newModel, { oldPath, newPath: csf.path });
    for (const td of af.typeDiffs) td.change.file = csf.path;
  } catch (error) {
    af.unanalyzed = true;
    af.typeDiffs = [];
    af.file.parseError = `Semantik diff başarısız: ${errorMessage(error)}`;
    warnings.push(`${csf.path}: semantik diff başarısız (${errorMessage(error)})`);
  }
}

/**
 * Repo indeksi. Değişen dosyaların head modeli (adım 2'de ayrıştırılmış) yeniden okunmaz/ayrıştırılmaz; yalnızca
 * diff dışındaki .java dosyaları okunur. Okuma eşzamanlı, ayrıştırma okuma tamamlandıkça yapılır.
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
  let failed = 0;
  const t0 = performance.now();
  const parsed = await mapLimit(toRead, INDEX_READ_CONCURRENCY, async (p) => {
    try {
      const src = await safeRead(cs, 'new', p);
      if (src === undefined) {
        failed++;
        return undefined;
      }
      try {
        return await parseJavaFile(p, src);
      } catch {
        failed++;
        return undefined;
      }
    } finally {
      counter.tick();
    }
  });
  timings.indexParse = performance.now() - t0;
  if (failed > 0) warnings.push(`Repo indeksinde ${failed} dosya okunamadı/ayrıştırılamadı; bu dosyalardaki çağıranlar görünmeyebilir`);
  const models = [...changedModels.values(), ...parsed.filter((m): m is JavaFileModel => m !== undefined)];
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

export async function buildReview(cs: ChangeSet, opts: BuildReviewOptions = {}): Promise<ReviewModel> {
  const progress = opts.onProgress ?? (() => undefined);
  const warnings: string[] = [];
  const maxIndexFiles = opts.maxIndexFiles ?? DEFAULT_MAX_INDEX_FILES;
  const tStart = performance.now();
  const timings: Record<string, number> = {};

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

  // 2. Değişen Java dosyalarını oku (eşzamanlı) + ayrıştır ve semantik diff (sırayla; CPU)
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
  for (let i = 0; i < javaFiles.length; i++) {
    const af = javaFiles[i];
    try {
      await analyzeJavaFile(af, sources[i], warnings);
    } catch (error) {
      af.unanalyzed = true;
      af.typeDiffs = [];
      af.file.parseError = `Analiz başarısız: ${errorMessage(error)}`;
      warnings.push(`${af.file.path}: analiz başarısız (${errorMessage(error)})`);
    }
    parseCounter.tick();
  }
  timings.parseChanged = performance.now() - tParse;
  const allDiffs = javaFiles.flatMap((af) => af.typeDiffs);
  try {
    detectCrossFileMoves(allDiffs);
  } catch (error) {
    warnings.push(`Dosyalar arası taşıma tespiti başarısız (${errorMessage(error)})`);
  }
  for (const af of javaFiles) {
    const pkg = (af.newModel ?? af.oldModel)?.packageName;
    if (pkg) af.file.packageName = pkg;
    af.file.typeIds = [...new Set(af.typeDiffs.map((td) => td.change.id))];
  }

  // 3. Repo indeksi
  const { index } = await buildIndex(cs, javaFiles, maxIndexFiles, warnings, progress, timings);

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
    brokenOverrides: new Map(),
    staleTypeRefs: new Map(),
    architecture: new Map(),
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
      findings.push(
        ...checkArchitecture(af.file.path, af.newModel, af.oldModel, af.cs.oldPath, {
          hexagonal,
          resolve: (name, file, type) => index.resolveTypeName(name, file, type),
          getType: (fqn) => index.getType(fqn),
          pathOfType: (fqn) => index.getFileOfType(fqn)?.path,
        }),
      );
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
  const locator = new TestLocator(repoFiles, (fqn) => index.filesReferencingType(fqn));
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
            outsideCallers: outsideCallerIds(ctx, mc.callers).length,
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

/** Aynı id'li tip iki kez gelirse (ör. tespit edilmemiş taşıma) head tarafı tutulur. */
function uniqueTypes(diffs: readonly TypeDiff[]): TypeChange[] {
  const byId = new Map<string, TypeDiff>();
  for (const td of diffs) {
    const prev = byId.get(td.change.id);
    if (!prev || (!prev.newType && td.newType)) byId.set(td.change.id, td);
  }
  return [...byId.values()].map((td) => td.change);
}

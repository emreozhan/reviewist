import type {
  CallRef,
  ChangeGroup,
  ChangeStatus,
  FileChange,
  Finding,
  FindingCategory,
  ImpactEdge,
  ImpactNode,
  Layer,
  MemberChange,
  MemberKind,
  ReviewModel,
  ReviewStep,
  RiskInfo,
  RiskLevel,
  TypeChange,
} from '../../../src/shared/types';

/**
 * Performans testleri ve görsel kontrol için sentetik büyük ReviewModel (guava sürüm aralığı ölçeğinde).
 * Deterministiktir (tohumlu PRNG): aynı seçeneklerle aynı model üretilir.
 */
export interface LargeReviewOptions {
  files?: number;
  types?: number;
  members?: number;
  findings?: number;
  groups?: number;
  seed?: number;
  id?: string;
}

export const LARGE_REVIEW_ID = 'sentetik-buyuk';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RISK_LEVELS: RiskLevel[] = ['low', 'low', 'low', 'medium', 'medium', 'high', 'critical'];
const SCORE: Record<RiskLevel, number> = { low: 12, medium: 38, high: 62, critical: 84 };
const LAYERS: Layer[] = ['domain', 'service', 'util', 'model', 'config', 'repository', 'other'];
const MEMBER_STATUSES: ChangeStatus[] = ['unchanged', 'unchanged', 'unchanged', 'unchanged', 'modified', 'modified', 'signatureChanged', 'added', 'removed', 'cosmetic', 'renamed', 'moved'];
const KINDS: MemberKind[] = ['method', 'method', 'method', 'method', 'field', 'constructor'];
const CATEGORIES: FindingCategory[] = ['callers', 'callers', 'api', 'test', 'test', 'risk', 'inheritance', 'architecture', 'complexity', 'cosmetic', 'other'];
const SEVERITIES: Finding['severity'][] = ['info', 'info', 'info', 'warning', 'warning', 'error'];
const NON_JAVA: { ext: string; lang: FileChange['language']; layer: Layer }[] = [
  { ext: 'xml', lang: 'xml', layer: 'build' },
  { ext: 'yaml', lang: 'yaml', layer: 'config' },
  { ext: 'properties', lang: 'properties', layer: 'resource' },
  { ext: 'md', lang: 'markdown', layer: 'other' },
  { ext: 'gradle', lang: 'gradle', layer: 'build' },
];
/** Aynı FQN birden çok kaynak kökünde (guava flavor'ları): kimliklere '@kök' soneki eklenir. */
const ROOTS = ['guava/src', 'android/guava/src'];

function risk(level: RiskLevel, why: string): RiskInfo {
  return { score: SCORE[level], level, reasons: level === 'low' ? [] : [{ code: 'synthetic', message: why, weight: SCORE[level] }] };
}

export function makeLargeReview(opts: LargeReviewOptions = {}): ReviewModel {
  const nFiles = opts.files ?? 2000;
  const nTypes = opts.types ?? 3000;
  const nMembers = opts.members ?? 20_000;
  const nFindings = opts.findings ?? 5000;
  const nGroups = opts.groups ?? 300;
  const rnd = mulberry32(opts.seed ?? 42);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
  const int = (n: number) => Math.floor(rnd() * n);

  const javaCount = Math.round(nFiles * 0.7);
  const files: FileChange[] = [];
  const javaFiles: { file: FileChange; pkg: string; base: string; root: string; dup: boolean }[] = [];
  for (let i = 0; i < nFiles; i++) {
    const isJava = i < javaCount;
    const level = pick(RISK_LEVELS);
    if (isJava) {
      const isTest = i % 5 === 0;
      const pkg = `com.google.common.p${i % 40}`;
      const base = `Synth${i}${isTest ? 'Test' : ''}`;
      const dup = i % 9 === 0;
      const root = dup ? (ROOTS[i % 2] ?? 'guava/src') : isTest ? 'guava-tests/test' : 'guava/src';
      const path = `${root}/${pkg.replace(/\./g, '/')}/${base}.java`;
      const file: FileChange = {
        id: path,
        path,
        status: i % 23 === 0 ? 'added' : i % 31 === 0 ? 'deleted' : 'modified',
        language: 'java',
        binary: false,
        additions: 1 + int(80),
        deletions: int(60),
        hunks: [
          {
            oldStart: 10,
            oldLines: 3,
            newStart: 10,
            newLines: 3,
            header: `class ${base}`,
            lines: [
              { type: 'context', oldNo: 10, newNo: 10, text: '  // bağlam' },
              { type: 'del', oldNo: 11, text: '  int x = 1;' },
              { type: 'add', newNo: 11, text: '  int x = 2;' },
              { type: 'context', oldNo: 12, newNo: 12, text: '}' },
            ],
          },
        ],
        packageName: pkg,
        layer: isTest ? 'test' : (LAYERS[i % LAYERS.length] ?? 'other'),
        isTest,
        cosmeticOnly: i % 11 === 0,
        typeIds: [],
        relatedTestFiles: isTest || i % 4 === 0 ? [] : [`guava-tests/test/${pkg.replace(/\./g, '/')}/${base}Test.java`],
        risk: risk(level, 'Sentetik dosya riski'),
        reviewOrder: i + 1,
        parseError: i % 397 === 0 ? 'Beklenmeyen belirteç (satır 120)' : undefined,
      };
      files.push(file);
      javaFiles.push({ file, pkg, base, root, dup });
    } else {
      const kind = NON_JAVA[i % NON_JAVA.length] ?? { ext: 'xml', lang: 'xml' as const, layer: 'build' as const };
      const path = `guava/res/r${i % 30}/conf${i}.${kind.ext}`;
      files.push({
        id: path,
        path,
        status: 'modified',
        language: kind.lang,
        binary: false,
        additions: 1 + int(10),
        deletions: int(10),
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '', lines: [{ type: 'del', oldNo: 1, text: 'a' }, { type: 'add', newNo: 1, text: 'b' }] }],
        layer: kind.layer,
        isTest: false,
        cosmeticOnly: i % 7 === 0,
        typeIds: [],
        relatedTestFiles: [],
        risk: risk(i % 13 === 0 ? 'medium' : 'low', 'Yapılandırma değişikliği'),
        reviewOrder: i + 1,
      });
    }
  }

  // Tipler: Java dosyalarına dağıtılır (ilk tip üst düzey, diğerleri iç tip).
  const types: TypeChange[] = [];
  for (let t = 0; t < nTypes; t++) {
    const jf = javaFiles[t % javaFiles.length];
    if (!jf) break;
    const inner = t >= javaFiles.length;
    const fqn = inner ? `${jf.pkg}.${jf.base}.Inner${t}` : `${jf.pkg}.${jf.base}`;
    const id = jf.dup ? `${fqn}@${jf.root}` : fqn;
    const level = pick(RISK_LEVELS);
    const type: TypeChange = {
      id,
      name: inner ? `Inner${t}` : jf.base,
      kind: t % 17 === 0 ? 'interface' : t % 29 === 0 ? 'enum' : 'class',
      file: jf.file.id,
      status: pick(['modified', 'modified', 'signatureChanged', 'added', 'cosmetic'] as const),
      flags: [],
      details: t % 6 === 0 ? ['üst tip değişti'] : [],
      visibility: 'public',
      annotations: t % 10 === 0 ? ['@GwtCompatible'] : [],
      superTypes: t % 3 === 0 ? ['java.lang.Object'] : [],
      subTypes: [],
      members: [],
      layer: jf.file.layer,
      risk: risk(level, 'Sentetik tip riski'),
    };
    types.push(type);
    jf.file.typeIds.push(id);
  }

  // Üyeler: tiplere döngüsel dağıtım; bir "hub" üyesi yüzlerce çağıranla (hashCode/equals benzeri).
  const allMembers: MemberChange[] = [];
  for (let k = 0; k < nMembers; k++) {
    const type = types[k % types.length];
    if (!type) break;
    const kind = pick(KINDS);
    const name = kind === 'constructor' ? type.name : kind === 'field' ? `field${k}` : `method${k}`;
    // Kurucular aynı adı taşır: kimlik benzersizliği için parametre listesi farklılaştırılır.
    const sigId = kind === 'field' ? name : kind === 'constructor' ? `${name}(int,String,T${k})` : `${name}(int,String)`;
    const status = pick(MEMBER_STATUSES);
    const level = status === 'unchanged' ? 'low' : pick(RISK_LEVELS);
    const member: MemberChange = {
      id: `${type.id}#${sigId}`,
      kind,
      name,
      ownerTypeId: type.id,
      signature: kind === 'field' ? `private int ${name}` : `public void ${name}(int a, String b)`,
      oldSignature: status === 'signatureChanged' ? `public void ${name}(int a)` : undefined,
      visibility: 'public',
      status,
      flags: status === 'signatureChanged' ? ['params'] : status === 'modified' ? ['body'] : [],
      details: status === 'signatureChanged' ? ['parametre eklendi: String b'] : [],
      oldRange: status === 'added' ? undefined : { startLine: 10 + (k % 400), endLine: 14 + (k % 400) },
      newRange: status === 'removed' ? undefined : { startLine: 10 + (k % 400), endLine: 15 + (k % 400) },
      linesAdded: status === 'unchanged' ? 0 : int(12),
      linesRemoved: status === 'unchanged' ? 0 : int(8),
      overrides: [],
      overriddenBy: [],
      callers: [],
      callees: [],
      risk: risk(level, 'Sentetik üye riski'),
    };
    type.members.push(member);
    allMembers.push(member);
  }
  const changed = allMembers.filter((m) => m.status !== 'unchanged');
  const typeById = new Map(types.map((t) => [t.id, t]));
  const confidences: CallRef['confidence'][] = ['exact', 'exact', 'likely', 'likely', 'name-only', 'name-only', 'name-only'];
  const outsideIds: string[] = [];
  for (let k = 0; k < 2000; k++) outsideIds.push(`com.google.common.outside.O${k % 400}#use${k}()`);
  changed.forEach((m, i) => {
    const count = i === 0 ? 800 : int(i % 10 === 0 ? 40 : 6);
    for (let c = 0; c < count; c++) {
      const fromOutside = rnd() < 0.5;
      const from = fromOutside ? (outsideIds[int(outsideIds.length)] ?? 'x') : (allMembers[int(allMembers.length)]?.id ?? 'x');
      const file = fromOutside ? `guava/src/com/google/common/outside/O${int(400)}.java` : (files[int(javaCount)]?.id ?? 'x');
      m.callers.push({ fromId: from, file, line: 1 + int(500), inChangedCode: !fromOutside && rnd() < 0.3, confidence: pick(confidences) });
    }
    if (i % 25 === 0) m.overriddenBy.push(`${types[int(types.length)]?.id ?? 'x'}#${m.name}(int,String)`);
  });

  // Graf: tipler + değişen üyeler + diff dışı etkilenenler.
  const nodes: ImpactNode[] = [];
  const edges: ImpactEdge[] = [];
  for (const t of types) nodes.push({ id: t.id, label: t.name, kind: t.kind, status: t.status, file: t.file, typeId: t.id, layer: t.layer, riskLevel: t.risk.level });
  for (const m of changed) {
    nodes.push({ id: m.id, label: `${m.name}()`, kind: m.kind, status: m.status, typeId: m.ownerTypeId, layer: 'other', riskLevel: m.risk.level });
    edges.push({ id: `c:${m.id}`, from: m.ownerTypeId, to: m.id, kind: 'contains' });
  }
  for (let k = 0; k < 400; k++) {
    const id = `com.google.common.outside.O${k}`;
    nodes.push({ id, label: `O${k}`, kind: 'class', status: 'impacted', file: `guava/src/com/google/common/outside/O${k}.java`, layer: 'other', riskLevel: 'low', range: { startLine: 1, endLine: 40 }, rangeSide: 'new' });
  }
  changed.slice(0, 6000).forEach((m, i) => {
    const to = changed[(i * 7 + 3) % changed.length];
    if (to) edges.push({ id: `k:${i}`, from: m.id, to: to.id, kind: 'calls' });
  });

  // Gruplar: biri dev (B14 benzeri: ~1150 sembol / ~330 dosya).
  const groups: ChangeGroup[] = [];
  for (let g = 0; g < nGroups; g++) {
    const size = g === 0 ? 1150 : 2 + int(14);
    const symbolIds: string[] = [];
    const fileIds = new Set<string>();
    for (let s = 0; s < size; s++) {
      const m = changed[(g * 37 + s * 13) % changed.length];
      if (!m) continue;
      symbolIds.push(m.id);
      const t = typeById.get(m.ownerTypeId);
      if (t && fileIds.size < (g === 0 ? 333 : 30)) fileIds.add(t.file);
    }
    if (g % 3 === 0) symbolIds.push(...outsideIds.slice(g, g + 20));
    groups.push({
      id: `grp-${g}`,
      title: g === 0 ? 'hashCode/equals sözleşmesi ve 1150 bağlı sembol' : `Grup ${g}: method${g} imzası ve çağıranları`,
      description: 'Sentetik grup açıklaması: birbirine çağrı ve kalıtımla bağlı değişiklikler.',
      symbolIds,
      fileIds: [...fileIds],
      riskLevel: pick(RISK_LEVELS),
    });
  }

  // Plan: her dosya bir adım (QA'deki 1878 adımlık plan gibi).
  const reviewPlan: ReviewStep[] = files.map((f, i) => ({
    order: i + 1,
    fileId: f.id,
    symbolIds: f.typeIds.slice(0, 2).flatMap((tid) => typeById.get(tid)?.members.filter((m) => m.status !== 'unchanged').slice(0, 5).map((m) => m.id) ?? []),
    reason: i % 3 === 0 ? 'Sözleşme önce: imza değişikliği çağıranları etkiliyor' : 'Gövde değişikliği',
  }));

  const findings: Finding[] = [];
  for (let k = 0; k < nFindings; k++) {
    const m = changed[k % changed.length];
    const f = files[k % files.length];
    findings.push({
      id: `f-${k}`,
      severity: pick(SEVERITIES),
      category: pick(CATEGORIES),
      title: `Sentetik bulgu ${k}: ${m?.name ?? 'sembol'} için kontrol`,
      message: 'Bu bulgu performans ölçümü için üretildi; içerik anlamlı değildir.',
      file: f?.id,
      line: 1 + (k % 300),
      symbolIds: m ? [m.id] : undefined,
    });
  }

  const warnings: string[] = [
    'Repo indeksi en fazla 5000 .java dosyasıyla sınırlandı (toplam 6120); bazı çağıranlar eksik olabilir.',
    'Repo indeksinde 3 dosya okunamadı: ClassUtilsOssFuzzTest.java (ikili içerik)',
  ];
  for (const f of files) if (f.parseError) warnings.push(`Ayrıştırma hatası: ${f.path} — ${f.parseError}`);

  const summary = {
    files: files.length,
    javaFiles: javaCount,
    testFiles: files.filter((f) => f.isTest).length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    typesChanged: types.length,
    membersChanged: changed.length,
    publicApiChanges: changed.filter((m) => m.status === 'signatureChanged' || m.status === 'removed').length,
    cosmeticFiles: files.filter((f) => f.cosmeticOnly).length,
    highRiskItems: changed.filter((m) => m.risk.level === 'high' || m.risk.level === 'critical').length,
    impactedOutsideDiff: 400,
    untestedChanges: 120,
  };

  return {
    id: opts.id ?? LARGE_REVIEW_ID,
    createdAt: '2026-10-03T00:00:00.000Z',
    source: {
      kind: 'git',
      title: 'v31.0...v33.0 (sentetik büyük review)',
      repoPath: 'C:/work/guava',
      baseRef: 'v31.0',
      headRef: 'v33.0',
      baseSha: '1111111111111111111111111111111111111111',
      headSha: '2222222222222222222222222222222222222222',
      stableKey: 'git:C:/work/guava:v31.0...v33.0:range',
    },
    summary,
    files,
    types,
    graph: { nodes, edges },
    groups,
    reviewPlan,
    findings,
    warnings,
  };
}

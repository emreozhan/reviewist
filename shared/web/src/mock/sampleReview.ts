import type { FileChange, ReviewModel, ReviewSummary, RiskInfo, TypeChange } from '../../../src/shared/types';
import { file, fillLineCounts, risk } from './build';
import { T } from './ids';
import { buildGraph } from './sampleGraph';
import { sampleFindings, sampleGroups, samplePlan } from './sampleMeta';
import { PATHS as P } from './samplePaths';
import { applicationTypes } from './typesApplication';
import { domainTypes } from './typesDomain';
import { paymentTypes } from './typesPayment';

export const SAMPLE_REVIEW_ID = 'ornek-shop-482';

function typeRisk(types: TypeChange[], ids: string[]): RiskInfo {
  const list = types.filter((t) => ids.includes(t.id));
  return list.reduce<RiskInfo>((best, t) => (t.risk.score > best.score ? t.risk : best), { score: 0, level: 'low', reasons: [] });
}

function buildFiles(types: TypeChange[]): FileChange[] {
  const j = (path: string, typeId: string, extra: Partial<Parameters<typeof file>[0]> = {}) => {
    const t = types.find((x) => x.id === typeId);
    const pkg = typeId.slice(0, typeId.lastIndexOf('.'));
    return file({
      path,
      status: 'modified',
      layer: t?.layer ?? 'other',
      packageName: pkg,
      typeIds: [typeId],
      risk: typeRisk(types, [typeId]),
      ...extra,
    });
  };
  return [
    j(P.paymentGateway, T.PG),
    j(P.paymentResult, T.PR, { status: 'added' }),
    j(P.paymentException, T.PE, { status: 'added' }),
    j(P.stripe, T.STRIPE, { relatedTestFiles: ['src/test/java/com/shop/adapter/out/payment/StripePaymentGatewayTest.java'] }),
    j(P.iyzico, T.IYZ),
    j(P.placeOrder, T.POS, { relatedTestFiles: [P.placeOrderTest] }),
    j(P.orderValidator, T.OV, { status: 'added' }),
    j(P.money, T.MONEY, { relatedTestFiles: [P.moneyTest] }),
    j(P.notifier, T.AN),
    j(P.stringUtils, T.SU, { relatedTestFiles: ['src/test/java/com/shop/util/StringUtilsTest.java'] }),
    j(P.order, T.ORDER, { relatedTestFiles: ['src/test/java/com/shop/domain/order/OrderTest.java'] }),
    j(P.orderController, T.OC, { relatedTestFiles: ['src/test/java/com/shop/adapter/in/web/OrderControllerIT.java'] }),
    j(P.cancelOrder, T.COS),
    j(P.placeOrderTest, T.POST, { isTest: true, layer: 'test' }),
    file({ path: P.migration, status: 'added', layer: 'resource', risk: risk(['schema-change', 'Şema değişikliği: benzersiz indeks', 30]) }),
    file({ path: P.pom, status: 'modified', layer: 'build', risk: risk(['dependency-major', 'Bağımlılıkta major sürüm yükseltmesi', 30], ['new-dependency', 'Yeni bağımlılık: flyway-core', 10]) }),
    file({ path: P.appYml, status: 'modified', layer: 'config', risk: risk(['config-change', 'Çalışma zamanı yapılandırması değişti', 15]) }),
    j(P.legacyFormatter, T.LMF, { status: 'deleted' }),
    file({ path: P.messages, oldPath: P.messagesOld, status: 'renamed', layer: 'resource', risk: risk(['renamed-resource', 'Kaynak dosya taşındı: yükleme yolu kontrol edilmeli', 10]) }),
    j(P.reportGenerator, T.RG, { cosmeticOnly: true }),
  ];
}

function buildSummary(model: Omit<ReviewModel, 'summary'>): ReviewSummary {
  const members = model.types.flatMap((t) => t.members);
  const isHigh = (l: string) => l === 'high' || l === 'critical';
  return {
    files: model.files.length,
    javaFiles: model.files.filter((f) => f.language === 'java').length,
    testFiles: model.files.filter((f) => f.isTest).length,
    additions: model.files.reduce((s, f) => s + f.additions, 0),
    deletions: model.files.reduce((s, f) => s + f.deletions, 0),
    typesChanged: model.types.filter((t) => t.status !== 'unchanged').length,
    membersChanged: members.filter((m) => m.status !== 'unchanged').length,
    publicApiChanges: members.filter((m) => m.visibility === 'public' && ['signatureChanged', 'removed', 'renamed', 'moved'].includes(m.status)).length,
    cosmeticFiles: model.files.filter((f) => f.cosmeticOnly).length,
    highRiskItems: members.filter((m) => isHigh(m.risk.level)).length + model.types.filter((t) => isHigh(t.risk.level)).length,
    impactedOutsideDiff: model.graph.nodes.filter((n) => n.status === 'impacted').length,
    untestedChanges: model.files.filter((f) => f.language === 'java' && !f.isTest && !f.cosmeticOnly && f.relatedTestFiles.length === 0).length,
  };
}

function build(): ReviewModel {
  const types = [...paymentTypes(), ...applicationTypes(), ...domainTypes()];
  const files = buildFiles(types);
  fillLineCounts(types, files);
  const plan = samplePlan();
  for (const f of files) f.reviewOrder = (plan.find((s) => s.fileId === f.id)?.order ?? files.length);
  const partial: Omit<ReviewModel, 'summary'> = {
    id: SAMPLE_REVIEW_ID,
    createdAt: '2026-10-02T09:41:00.000Z',
    source: {
      kind: 'github',
      title: 'Ödeme akışını idempotent hale getir, bildirimleri sadeleştir',
      repoPath: 'C:/work/shop',
      baseRef: 'main',
      headRef: 'feature/ai-refactor',
      baseSha: 'a1c9e04d7b2f6e3a9c1d5e8f0b4a7c2d9e6f1a3b',
      headSha: '7f3b2e91c4d8a6f0e2b5c9d1a7e4f8b3c6d0a2e5',
      prUrl: 'https://github.com/acme/shop/pull/482',
      prNumber: 482,
      author: 'ai-refactor-bot',
      stableKey: 'github:acme/shop#482',
      description: 'Ödeme çağrılarına idempotency anahtarı eklendi, doğrulama ayrı bileşene taşındı, bildirimler sadeleştirildi.',
    },
    files,
    types,
    graph: buildGraph(types),
    groups: sampleGroups(),
    reviewPlan: plan,
    findings: sampleFindings(),
    warnings: ['RefundService.java içindeki charge çağrısı yalnızca ad ve parametre sayısıyla eşleştirildi (confidence: likely).'],
  };
  return { ...partial, summary: buildSummary(partial) };
}

/** Elle tasarlanmış, içerikten tutarlı biçimde hesaplanan örnek ReviewModel. */
export const sampleReview: ReviewModel = build();

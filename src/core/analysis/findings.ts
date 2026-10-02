/**
 * Risk nedenlerinden bulgu üretimi, bulgu sıralaması ve özet (ReviewSummary) hesabı.
 * Bulgu id'leri kararlıdır: `${kategori}:${kod}:${sembol|dosya}`.
 */
import type { CallRef, FileChange, Finding, FindingCategory, MemberChange, ReviewSummary, RiskReason, TypeChange } from '../../shared/types.js';
import { isApiVisible, isBreakingSignature, isSemanticChange } from './risk.js';
import { basename, RISK_LEVEL_ORDER, symbolLabel } from './util.js';

type Severity = Finding['severity'];

interface Rule {
  category: FindingCategory;
  severity: Severity;
  title: (label: string, r: RiskReason) => string;
  /** Test dosyalarında da üretilsin mi */
  inTests?: boolean;
}

const MEMBER_RULES: Record<string, Rule> = {
  'removed-with-callers': { category: 'callers', severity: 'error', title: (l) => `Silinmiş/değişmiş ama hâlâ çağrılıyor: ${l}`, inTests: true },
  'override-broken': { category: 'inheritance', severity: 'error', title: (l) => `Alt sınıflardaki override'lar koptu: ${l}`, inTests: true },
  'public-api-signature': { category: 'api', severity: 'warning', title: (l) => `Public API imzası değişti: ${l}` },
  'public-api-removed': { category: 'api', severity: 'warning', title: (l) => `Public üye silindi: ${l}` },
  'public-api-renamed': { category: 'api', severity: 'warning', title: (l) => `Public üye yeniden adlandırıldı: ${l}` },
  'interface-contract': { category: 'inheritance', severity: 'warning', title: (l) => `Sözleşme değişikliği tüm implementasyonları etkiliyor: ${l}` },
  'interface-default': { category: 'inheritance', severity: 'info', title: (l) => `Arayüz default metodu değişti: ${l}` },
  'overridden-behavior': { category: 'inheritance', severity: 'warning', title: (l) => `Override edilen metodun davranışı değişti: ${l}` },
  'template-method': { category: 'inheritance', severity: 'warning', title: (l) => `Şablon metot değişti, alt sınıflar etkilenir: ${l}` },
  'equality-contract': { category: 'risk', severity: 'warning', title: (l) => `Eşitlik/sıralama sözleşmesi değişti: ${l}` },
  'equals-hashcode-mismatch': { category: 'risk', severity: 'warning', title: (l) => `equals/hashCode tutarsız değişti: ${l}` },
  concurrency: { category: 'risk', severity: 'warning', title: (l) => `Eşzamanlılık davranışı değişti: ${l}` },
  'static-mutable': { category: 'risk', severity: 'warning', title: (l) => `Değişebilir static durum: ${l}` },
  'empty-catch': { category: 'risk', severity: 'warning', title: (l) => `Boş catch bloğu: ${l}` },
  'generic-throw': { category: 'risk', severity: 'info', title: (l) => `Genel istisna fırlatılıyor: ${l}` },
  'generic-catch': { category: 'risk', severity: 'info', title: (l) => `Genel istisna yakalanıyor: ${l}` },
  'catch-changed': { category: 'risk', severity: 'info', title: (l) => `Hata yönetimi değişti: ${l}` },
  'print-stack-trace': { category: 'risk', severity: 'info', title: (l) => `printStackTrace kullanımı: ${l}` },
  'system-out': { category: 'risk', severity: 'info', title: (l) => `System.out kullanımı: ${l}` },
  'sql-change': { category: 'risk', severity: 'warning', title: (l) => `SQL değişti: ${l}` },
  complexity: { category: 'complexity', severity: 'info', title: (l) => `Karmaşıklık arttı: ${l}` },
  'null-checks-decreased': { category: 'risk', severity: 'info', title: (l) => `Null kontrolleri azaldı: ${l}` },
  'returns-null': { category: 'risk', severity: 'info', title: (l) => `'return null' eklendi: ${l}` },
  'callers-outside-diff': { category: 'callers', severity: 'info', title: (l) => `Diff dışındaki çağıranlar etkileniyor: ${l}` },
};

const TYPE_RULES: Record<string, Rule> = {
  'removed-with-callers': { category: 'callers', severity: 'error', title: (l) => `Silinmiş/taşınmış tip hâlâ kullanılıyor: ${l}`, inTests: true },
  'type-removed': { category: 'api', severity: 'warning', title: (l) => `Public tip silindi: ${l}` },
  'type-renamed': { category: 'api', severity: 'warning', title: (l) => `Public tip yeniden adlandırıldı/taşındı: ${l}` },
  'supertypes-changed': { category: 'inheritance', severity: 'warning', title: (l) => `Kalıtım hiyerarşisi değişti: ${l}` },
  'visibility-narrowed': { category: 'api', severity: 'warning', title: (l) => `Tip görünürlüğü daraldı: ${l}` },
};

const FILE_RULES: Record<string, Rule> = {
  'sql-migration': { category: 'risk', severity: 'warning', title: (l) => `Veritabanı migration'ı: ${l}` },
  'build-dependency': { category: 'risk', severity: 'info', title: (l) => `Bağımlılık değişikliği: ${l}` },
  'config-change': { category: 'risk', severity: 'info', title: (l) => `Yapılandırma değişikliği: ${l}` },
  unanalyzed: { category: 'other', severity: 'warning', title: (l) => `Sembol analizi yapılamadı: ${l}` },
};

function ruleFor(code: string, rules: Record<string, Rule>): Rule | undefined {
  if (rules[code]) return rules[code];
  if (code.startsWith('annotation-')) {
    return { category: 'risk', severity: 'warning', title: (l) => `Anlam taşıyan anotasyon değişti: ${l}` };
  }
  return undefined;
}

export interface MemberFindingInput {
  mc: MemberChange;
  owner: TypeChange;
  file: FileChange;
  staleCalls: readonly CallRef[];
  outsideCallers: number;
  /** Bu üye, diff'te imzası/sözleşmesi değişen bir üst tip metodunu override ediyor (sonuç değişikliği). */
  followsChangedContract?: boolean;
}

const API_CODES = new Set(['public-api-signature', 'public-api-removed', 'public-api-renamed']);

export function memberFindings(input: MemberFindingInput): Finding[] {
  const { mc, file } = input;
  if (!isSemanticChange(mc.status)) return [];
  const out: Finding[] = [];
  const label = mc.status === 'renamed' && mc.oldName ? `${input.owner.name}.${mc.oldName} → ${mc.name}` : symbolLabel(mc.id);
  const line = mc.newRange?.startLine ?? mc.oldRange?.startLine;
  for (const r of mc.risk.reasons) {
    const rule = ruleFor(r.code, MEMBER_RULES);
    if (!rule) continue;
    if (file.isTest && !rule.inTests) continue;
    if (r.code === 'callers-outside-diff' && input.outsideCallers < 2) continue;
    // Tip tamamen silindiyse üye bazlı API bulguları tip bulgusunda toplanır.
    if (API_CODES.has(r.code) && input.owner.status === 'removed') continue;
    // Değişen sözleşmeyi izleyen implementasyon: asıl bulgu sözleşme üyesinde.
    if ((API_CODES.has(r.code) || r.code === 'interface-contract') && input.followsChangedContract) continue;
    // Silinmiş-ama-çağrılan hatası varsa ayrıca "public üye silindi" yazılmaz.
    if (API_CODES.has(r.code) && input.staleCalls.length > 0) continue;
    // Implementasyonu olmayan arayüze eklenen soyut metot (ör. Spring Data) sözleşme bulgusu üretmez.
    if (r.code === 'interface-contract' && r.weight <= 5) continue;
    let message = r.message;
    let symbolIds = [mc.id];
    let severity = rule.severity;
    let title = rule.title(label, r);
    if (r.code.startsWith('annotation-')) {
      const cut = r.message.indexOf('):');
      title = `${cut > 0 ? r.message.slice(0, cut + 1) : 'Anlam taşıyan anotasyon'}: ${label}`;
      if (mc.status === 'added') severity = 'info';
    }
    if (r.code === 'public-api-removed' && input.outsideCallers === 0) {
      severity = 'info';
      message = `${r.message}. Repoda çağıranı kalmadı; harici kullanıcılar (başka modül/servis) varsa kırılır.`;
    }
    if (r.code === 'removed-with-callers') {
      const sites = input.staleCalls.slice(0, 5).map((c) => `${c.file}:${c.line}${c.inChangedCode ? ' (bu diff içinde)' : ''}`);
      message = `${r.message}. Çağrı yerleri: ${sites.join(', ')}${input.staleCalls.length > 5 ? ' ...' : ''}`;
      symbolIds = [mc.id, ...new Set(input.staleCalls.map((c) => c.fromId))];
    }
    if ((r.code === 'public-api-signature' || r.code === 'public-api-removed' || r.code === 'public-api-renamed') && input.outsideCallers > 0) {
      message = `${r.message}. Diff dışında ${input.outsideCallers} çağıranı var.`;
    }
    if (r.code === 'callers-outside-diff' && RISK_LEVEL_ORDER[mc.risk.level] >= RISK_LEVEL_ORDER.high) severity = 'warning';
    out.push({
      id: `${rule.category}:${r.code}:${mc.id}`,
      severity,
      category: rule.category,
      title,
      message,
      file: file.path,
      line,
      symbolIds,
    });
  }
  return out;
}

export function typeFindings(tc: TypeChange, file: FileChange): Finding[] {
  const out: Finding[] = [];
  for (const r of tc.risk.reasons) {
    // Tip riski üyelerin nedenlerini de içerir; yalnızca tip düzeyi kodlar ve 'Tip anotasyonu' nedenleri burada.
    const typeLevel = TYPE_RULES[r.code] !== undefined || (r.code.startsWith('annotation-') && r.message.startsWith('Tip anotasyonu'));
    if (!typeLevel) continue;
    if (r.code === 'removed-with-callers' && !r.message.startsWith('Tip')) continue;
    const rule = ruleFor(r.code, TYPE_RULES);
    if (!rule) continue;
    if (file.isTest && !rule.inTests) continue;
    const referenced = tc.risk.reasons.some((x) => x.code === 'removed-with-callers' && x.message.startsWith('Tip'));
    const safeDelete = (r.code === 'type-removed' || r.code === 'type-renamed') && !referenced;
    out.push({
      id: `${rule.category}:${r.code}:${tc.id}`,
      severity: safeDelete ? 'info' : rule.severity,
      category: rule.category,
      title: r.code.startsWith('annotation-') ? `Tip anotasyonu değişti: ${tc.name}` : rule.title(tc.name, r),
      message: safeDelete ? `${r.message}. Head'de eski ada referans kalmadı; repo içinde güvenli görünüyor.` : r.message,
      file: file.path,
      line: tc.newRange?.startLine ?? tc.oldRange?.startLine,
      symbolIds: [tc.id],
    });
  }
  return out;
}

export function fileFindings(file: FileChange): Finding[] {
  const out: Finding[] = [];
  for (const r of file.risk.reasons) {
    const rule = FILE_RULES[r.code];
    if (!rule) continue;
    out.push({ id: `${rule.category}:${r.code}:${file.path}`, severity: rule.severity, category: rule.category, title: rule.title(basename(file.path), r), message: r.message, file: file.path });
  }
  if (file.parseError) {
    out.push({
      id: `other:parse-error:${file.path}`,
      severity: 'warning',
      category: 'other',
      title: `Ayrıştırma sorunu: ${basename(file.path)}`,
      message: `${file.parseError}. Bu dosyanın sembol analizi eksik veya hatalı olabilir; diff'i elle kontrol edin.`,
      file: file.path,
    });
  }
  return out;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const CATEGORY_ORDER: Record<FindingCategory, number> = { callers: 0, api: 1, inheritance: 2, architecture: 3, risk: 4, test: 5, complexity: 6, other: 7, cosmetic: 8 };

/** Tekrarları (aynı id) atar ve önem sırasına dizer. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const f of findings) {
    const prev = byId.get(f.id);
    if (!prev || SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[prev.severity]) byId.set(f.id, f);
  }
  return [...byId.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
      (a.file ?? '').localeCompare(b.file ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

export function computeSummary(files: readonly FileChange[], types: readonly TypeChange[], impactedOutsideDiff: number, untestedChanges: number): ReviewSummary {
  const memberList = types.flatMap((t) => t.members.map((m) => ({ m, t })));
  const semanticMembers = memberList.filter(({ m }) => isSemanticChange(m.status));
  const apiStatuses = new Set(['removed', 'renamed', 'moved']);
  const publicApiChanges =
    semanticMembers.filter(({ m, t }) => (apiStatuses.has(m.status) || isBreakingSignature(m)) && isApiVisible(m.visibility, t.visibility, t.kind)).length +
    types.filter((t) => apiStatuses.has(t.status) && (t.visibility === 'public' || t.visibility === 'protected')).length;
  const nonJavaHigh = files.filter((f) => f.typeIds.length === 0 && RISK_LEVEL_ORDER[f.risk.level] >= RISK_LEVEL_ORDER.high).length;
  const typeOnlyHigh = types.filter((t) => isSemanticChange(t.status) && !t.members.some((m) => isSemanticChange(m.status)) && RISK_LEVEL_ORDER[t.risk.level] >= RISK_LEVEL_ORDER.high).length;
  return {
    files: files.length,
    javaFiles: files.filter((f) => f.language === 'java').length,
    testFiles: files.filter((f) => f.isTest).length,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    typesChanged: types.filter((t) => isSemanticChange(t.status) || t.members.some((m) => isSemanticChange(m.status))).length,
    membersChanged: semanticMembers.length,
    publicApiChanges,
    cosmeticFiles: files.filter((f) => f.cosmeticOnly).length,
    highRiskItems: semanticMembers.filter(({ m }) => RISK_LEVEL_ORDER[m.risk.level] >= RISK_LEVEL_ORDER.high).length + nonJavaHigh + typeOnlyHigh,
    impactedOutsideDiff,
    untestedChanges,
  };
}

import type {
  CallRef,
  ChangeFlag,
  FileStatus,
  Finding,
  ImpactEdge,
  ImpactNodeStatus,
  RiskLevel,
  SymbolKind,
  TypeKind,
} from '../../../src/shared/types';

export interface StatusMeta {
  label: string;
  glyph: string;
}

/** Durum: renk her zaman glif ile birlikte (renk körlüğüne dayanıklı). */
export const STATUS_META: Record<ImpactNodeStatus, StatusMeta> = {
  added: { label: 'Eklendi', glyph: '+' },
  removed: { label: 'Silindi', glyph: '−' },
  modified: { label: 'Gövde değişti', glyph: '~' },
  signatureChanged: { label: 'İmza değişti', glyph: 'Δ' },
  renamed: { label: 'Yeniden adlandırıldı', glyph: '≈' },
  moved: { label: 'Taşındı', glyph: '→' },
  cosmetic: { label: 'Kozmetik', glyph: '·' },
  unchanged: { label: 'Değişmedi', glyph: '○' },
  impacted: { label: 'Etkilenen (değişmedi)', glyph: '◌' },
};

export const FILE_STATUS_META: Record<FileStatus, StatusMeta & { status: ImpactNodeStatus }> = {
  added: { label: 'Yeni dosya', glyph: 'A', status: 'added' },
  deleted: { label: 'Silinen dosya', glyph: 'D', status: 'removed' },
  modified: { label: 'Değişen dosya', glyph: 'M', status: 'modified' },
  renamed: { label: 'Yeniden adlandırılan dosya', glyph: 'R', status: 'renamed' },
  copied: { label: 'Kopyalanan dosya', glyph: 'C', status: 'moved' },
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

export const RISK_BARS: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export const KIND_LABEL: Record<SymbolKind, string> = {
  class: 'sınıf',
  interface: 'arayüz',
  enum: 'enum',
  record: 'record',
  annotation: 'anotasyon',
  method: 'metot',
  constructor: 'kurucu',
  field: 'alan',
  enumConstant: 'enum sabiti',
  initializer: 'başlatıcı',
};

export const JAVA_KEYWORD: Record<TypeKind, string> = {
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  record: 'record',
  annotation: '@interface',
};

export const FLAG_LABEL: Record<ChangeFlag, string> = {
  visibility: 'görünürlük',
  modifiers: 'niteleyiciler',
  annotations: 'anotasyonlar',
  params: 'parametreler',
  returnType: 'dönüş tipi',
  throws: 'throws',
  body: 'gövde',
  javadoc: 'javadoc',
  formatting: 'biçim',
  typeParams: 'tip parametreleri',
  fieldType: 'alan tipi',
  initializer: 'başlatıcı',
  supertypes: 'üst tip/arayüz',
};

export const CONFIDENCE_LABEL: Record<CallRef['confidence'], string> = {
  exact: 'kesin',
  likely: 'olası',
  'name-only': 'yalnız ad',
};

export const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  error: 'Hata',
  warning: 'Uyarı',
  info: 'Bilgi',
};

export const EDGE_LABEL: Record<ImpactEdge['kind'], string> = {
  calls: 'çağırır',
  overrides: 'override eder',
  extends: 'genişletir',
  implements: 'uygular',
  contains: 'içerir',
  tests: 'test eder',
};

export const STATUS_ORDER: ImpactNodeStatus[] = [
  'signatureChanged', 'removed', 'added', 'modified', 'renamed', 'moved', 'cosmetic', 'impacted', 'unchanged',
];

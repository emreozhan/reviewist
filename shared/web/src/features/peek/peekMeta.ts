import type { ImpactNodeStatus, RiskLevel, SymbolDecl, SymbolKind } from '../../../../src/shared/types';
import { STATUS_META } from '../../lib/labels';
import type { PeekEntry } from '../../lib/peekStack';
import type { ReviewIndex } from '../../lib/reviewIndex';
import { symbolLabel } from '../../lib/reviewIndex';

export interface PeekMeta {
  /** 'PaymentGateway' */
  typeName: string;
  /** '.charge()' (üye değilse boş) */
  memberPart: string;
  kind?: SymbolKind;
  signature?: string;
  status: ImpactNodeStatus;
  statusText: string;
  /** Sembol bu review'da değişti (başlıkta durum rengi şeridi). */
  changed: boolean;
  risk?: { level: RiskLevel; score?: number };
}

/** Pencere başlığı bilgileri: ReviewModel'deki durum, imza, risk; değişmemişse "etkilenen kod". */
export function peekMeta(index: ReviewIndex, entry: PeekEntry, decl?: SymbolDecl): PeekMeta {
  const id = entry.symbolId;
  const m = index.memberById.get(id);
  const t = index.typeById.get(id);
  const node = index.nodeById.get(id);
  const label = symbolLabel(index, id);
  // Üye kimlikleri '#' içerir ('com.acme.Foo#bar(int)'); üye adında nokta olmaz: son nokta tip/üye ayracıdır.
  const isMember = !!m || id.includes('#');
  const dot = isMember ? label.lastIndexOf('.') : -1;
  const typeName = dot > 0 ? label.slice(0, dot) : label;
  const memberPart = dot > 0 ? label.slice(dot) : '';
  const own = m?.status ?? t?.status;
  const inDiff = index.symbolFile.get(id) === entry.target.path;
  const deleted = entry.target.side === 'old';
  let status: ImpactNodeStatus;
  let statusText: string;
  if (own && own !== 'unchanged' && inDiff) {
    status = own;
    statusText = STATUS_META[own].label;
  } else if (deleted) {
    status = 'removed';
    statusText = 'Silindi — eski sürüm';
  } else if (entry.target.inDiff) {
    status = 'unchanged';
    statusText = 'Değişmedi — değişen dosyada';
  } else {
    status = 'impacted';
    statusText = 'Değişmedi — etkilenen kod';
  }
  const changed = status !== 'unchanged' && status !== 'impacted';
  const riskInfo = m?.risk ?? t?.risk;
  const risk = changed && riskInfo && riskInfo.score > 0
    ? { level: riskInfo.level, score: riskInfo.score }
    : node && node.status === 'impacted' && node.riskLevel !== 'low'
      ? { level: node.riskLevel }
      : undefined;
  return {
    typeName,
    memberPart,
    kind: m?.kind ?? t?.kind ?? decl?.kind ?? node?.kind,
    signature: m?.signature ?? decl?.signature,
    status,
    statusText,
    changed,
    risk,
  };
}

/** Durumun renk belirteci (başlık şeridi ve kenar için). */
export const STATUS_VAR: Record<ImpactNodeStatus, string> = {
  added: 'var(--st-added)',
  removed: 'var(--st-removed)',
  modified: 'var(--st-modified)',
  signatureChanged: 'var(--st-signature)',
  renamed: 'var(--st-renamed)',
  moved: 'var(--st-moved)',
  cosmetic: 'var(--st-cosmetic)',
  unchanged: 'var(--st-unchanged)',
  impacted: 'var(--st-impacted)',
};

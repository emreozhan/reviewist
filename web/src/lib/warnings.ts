import type { ReviewModel } from '../../../src/shared/types';

export type WarningKind = 'parse' | 'limit' | 'read' | 'other';

export const WARNING_KIND_LABEL: Record<WarningKind, string> = {
  parse: 'Ayrıştırma hataları',
  limit: 'Limit / kapsam',
  read: 'Okunamayan dosyalar',
  other: 'Diğer',
};

const ORDER: WarningKind[] = ['parse', 'limit', 'read', 'other'];

/** Sunucunun Türkçe uyarı metnini kabaca sınıflar (sözleşme yapılandırılmış tür vermiyor). */
export function classifyWarning(text: string): WarningKind {
  const t = text.toLocaleLowerCase('tr');
  if (/ayrıştır|parse|sözdizimi|syntax/.test(t)) return 'parse';
  if (/limit|sınır|en fazla|maks|üst sınır|aşıldı|kesildi|atlandı|kırpıldı/.test(t)) return 'limit';
  if (/okunamadı|okunamıyor|ikili|binary|erişilemedi/.test(t)) return 'read';
  return 'other';
}

export interface WarningGroup {
  kind: WarningKind;
  messages: string[];
}

export interface WarningSummary {
  groups: WarningGroup[];
  /** Ayrıştırma hatası olan diff dosyaları (yapı görünümü eksik olabilir). */
  parseErrorFiles: { path: string; error: string }[];
  total: number;
}

export function summarizeWarnings(review: ReviewModel): WarningSummary {
  const byKind = new Map<WarningKind, string[]>();
  for (const w of review.warnings) {
    const k = classifyWarning(w);
    const list = byKind.get(k);
    if (list) list.push(w);
    else byKind.set(k, [w]);
  }
  const parseErrorFiles: { path: string; error: string }[] = [];
  for (const f of review.files) if (f.parseError) parseErrorFiles.push({ path: f.path, error: f.parseError });
  const groups = ORDER.filter((k) => byKind.has(k)).map((kind) => ({ kind, messages: byKind.get(kind) ?? [] }));
  return { groups, parseErrorFiles, total: review.warnings.length + parseErrorFiles.length };
}

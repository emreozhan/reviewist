import { useMemo } from 'react';
import type { HlLang } from '../lib/highlight';
import { highlightLines } from '../lib/highlight';

/** Tüm dosyayı bağlamıyla renklendirir (çok satırlı yorumlar doğru renk alır). Pahalı olduğu için memo'lanır. */
export function useHighlighted(content: string | null, lang: HlLang | null): string[] | null {
  return useMemo(() => (content === null ? null : highlightLines(content, lang)), [content, lang]);
}

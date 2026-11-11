import { useCallback } from 'react';
import type { Tab } from '../lib/route';
import { navigate, parseHash } from '../lib/route';
import { useReviewCtx } from '../features/workspace/ReviewContext';
import { useCodeNav } from './useCodeNav';

function setTab(reviewId: string, tab: Tab): void {
  const current = parseHash(window.location.hash);
  if (current.name === 'review' && current.tab === tab) return;
  // Seçim adreste kalır: sekme geçişi geri tuşuyla aynı seçimle geri alınabilir.
  const params = current.name === 'review' && current.id === reviewId ? { ...current.params, line: undefined } : {};
  navigate({ name: 'review', id: reviewId, tab, params });
}

/** Bulgu, graf düğümü veya yayılım öğesinden çalışma alanındaki dosya/sembol/satıra gitme. */
export function useOpenLocation() {
  const { index } = useReviewCtx();
  const nav = useCodeNav();

  // Bulgu/graf konumu kalıcı sekmede öne gelir (Ctrl+tık: arka planda); çalışma alanına geçilir.
  return useCallback(
    (target: { file?: string; line?: number; symbolIds?: string[] }, opts?: { background?: boolean }): boolean => {
      const symbol = target.symbolIds?.find((id) => index.symbolFile.has(id));
      const file = target.file && index.fileById.has(target.file) ? target.file : symbol ? index.symbolFile.get(symbol) : undefined;
      if (!file) {
        const any = target.symbolIds?.[0];
        if (!any) return false;
        void nav.openSymbol(any, opts);
        return true;
      }
      const symbolInFile = target.symbolIds?.find((id) => index.symbolFile.get(id) === file);
      nav.openTarget({ path: file, side: 'new', inDiff: true, symbolId: symbolInFile, line: target.line, callSite: !!target.line }, opts);
      return true;
    },
    [index, nav],
  );
}

export function useSetTab() {
  const { review } = useReviewCtx();
  return useCallback((tab: Tab) => setTab(review.id, tab), [review.id]);
}

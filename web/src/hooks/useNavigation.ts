import { useCallback } from 'react';
import type { Tab } from '../lib/route';
import { navigate, parseHash } from '../lib/route';
import { useReviewCtx } from '../features/workspace/ReviewContext';
import { useUi } from '../state/uiStore';

function setTab(reviewId: string, tab: Tab): void {
  const current = parseHash(window.location.hash);
  if (current.name === 'review' && current.tab === tab) return;
  navigate({ name: 'review', id: reviewId, tab, params: {} });
}

/** Bulgu, graf düğümü veya yayılım öğesinden çalışma alanındaki dosya/sembol/satıra gitme. */
export function useOpenLocation() {
  const { review, index } = useReviewCtx();
  const selectFile = useUi((s) => s.selectFile);
  const selectSymbol = useUi((s) => s.selectSymbol);
  const goToLine = useUi((s) => s.goToLine);

  return useCallback(
    (target: { file?: string; line?: number; symbolIds?: string[] }): boolean => {
      const symbol = target.symbolIds?.find((id) => index.symbolFile.has(id));
      const file = target.file && index.fileById.has(target.file) ? target.file : symbol ? index.symbolFile.get(symbol) : undefined;
      if (!file) return false;
      const symbolInFile = target.symbolIds?.find((id) => index.symbolFile.get(id) === file);
      if (target.line) goToLine(file, target.line, symbolInFile);
      else if (symbolInFile) selectSymbol(symbolInFile, file);
      else selectFile(file);
      setTab(review.id, 'workspace');
      return true;
    },
    [index, review.id, selectFile, selectSymbol, goToLine],
  );
}

export function useSetTab() {
  const { review } = useReviewCtx();
  return useCallback((tab: Tab) => setTab(review.id, tab), [review.id]);
}

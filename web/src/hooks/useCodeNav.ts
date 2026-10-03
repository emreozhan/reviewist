import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { useReviewCtx } from '../features/workspace/ReviewContext';
import type { NavTarget } from '../lib/navTarget';
import { fromLocation, needsLocate, resolveLocal, targetFromEntry, toOpenSpec } from '../lib/navTarget';
import type { ReviewIndex } from '../lib/reviewIndex';
import { navigate, parseHash } from '../lib/route';
import type { EditorTab } from '../lib/tabs';
import { tabKey } from '../lib/tabs';
import { useTabs } from '../state/tabsStore';
import { useUi } from '../state/uiStore';
import { fetchLocation, useApi } from './queries';

/** Arka planda açılıp henüz öne gelmemiş sekmeler: ilk etkinleştirmede odak satırına gidilir. */
const pendingFocus = new Set<string>();

function ensureWorkspace(reviewId: string): void {
  const current = parseHash(window.location.hash);
  if (current.name === 'review' && current.tab !== 'workspace') {
    navigate({ name: 'review', id: reviewId, tab: 'workspace', params: { ...current.params, line: undefined } });
  }
}

/** Diff içi sekme etkinleşince seçimi (dosya/sembol/satır) çalışma alanına uygular; `scroll` ile satıra gidilir. */
function applyInDiff(index: ReviewIndex, t: { path: string; symbolId?: string; line?: number }, scroll: boolean): void {
  const ui = useUi.getState();
  const symbolInDiff = t.symbolId && index.symbolFile.get(t.symbolId) === t.path ? t.symbolId : undefined;
  if (scroll && t.line) ui.goToLine(t.path, t.line, symbolInDiff);
  else if (symbolInDiff) ui.selectSymbol(symbolInDiff, t.path);
  else ui.selectFile(t.path);
}

/**
 * Diff içi hedefte satıra mı gidilmeli: çağrı yeri, modelde olmayan sembol ya da Yapı görünümünde
 * varsayılan gizli olan değişmemiş üye (diff görünümünde satırına gidilir).
 */
function wantsLine(index: ReviewIndex, t: NavTarget): boolean {
  if (!t.line) return false;
  if (t.callSite || !t.symbolId || index.symbolFile.get(t.symbolId) !== t.path) return true;
  return index.memberById.get(t.symbolId)?.status === 'unchanged';
}

export interface OpenOpts {
  /** Arka planda aç (Ctrl/Cmd+tık, orta tık). */
  background?: boolean;
  /** Önizleme sekmesi olarak aç. */
  preview?: boolean;
}

/**
 * Kod gezinme: sembolü/dosyayı sekmede açma, sekmeye geçme, geri/ileri.
 * Konum önce ReviewModel'den, gerekirse `/locate` ucundan bulunur (uç yoksa tahmine düşülür).
 */
export function useCodeNav() {
  const { review, index } = useReviewCtx();
  const { api, mock } = useApi();
  const client = useQueryClient();

  const openTarget = useCallback(
    (t: NavTarget, opts: OpenOpts = {}) => {
      const spec = toOpenSpec(index, t);
      const tabs = useTabs.getState();
      tabs.open(spec, { preview: opts.preview ?? false, activate: !opts.background });
      const key = tabKey(t.path, t.side);
      if (opts.background) {
        pendingFocus.add(key);
        return;
      }
      pendingFocus.delete(key);
      if (t.inDiff) applyInDiff(index, t, wantsLine(index, t));
      ensureWorkspace(review.id);
    },
    [index, review.id],
  );

  /** Sembolün sınıfını sekmede açar ve sembole odaklanır (varsayılan: yeni kalıcı sekme, öne gelir). */
  const openSymbol = useCallback(
    async (symbolId: string, opts: OpenOpts & { hint?: { file?: string; line?: number; side?: 'old' | 'new'; callSite?: boolean } } = {}): Promise<boolean> => {
      let target = resolveLocal(index, symbolId, opts.hint);
      if (needsLocate(target) && !opts.hint?.file) {
        const loc = await fetchLocation(client, api, mock, review.id, symbolId);
        if (loc) target = fromLocation(index, loc);
      }
      if (!target) return false;
      openTarget(target, opts);
      return true;
    },
    [index, client, api, mock, review.id, openTarget],
  );

  /** Sekme çubuğundan geçiş: diff içinde ise seçim uygulanır (arka planda açılmışsa odağa kaydırılır). */
  const activateTab = useCallback(
    (tab: EditorTab, opts?: { skipHistory?: boolean }) => {
      const pending = pendingFocus.delete(tab.key);
      useTabs.getState().activate(tab.key, opts);
      if (tab.inDiff) applyInDiff(index, tab, pending && wantsLine(index, tab));
      ensureWorkspace(review.id);
    },
    [index, review.id],
  );

  const applyHistory = useCallback(
    (entry: ReturnType<ReturnType<typeof useTabs.getState>['step']>) => {
      if (!entry) return;
      const t = targetFromEntry(entry);
      useTabs.getState().open(toOpenSpec(index, t), { preview: false, activate: true, skipHistory: true });
      if (t.inDiff) applyInDiff(index, t, wantsLine(index, t));
      ensureWorkspace(review.id);
    },
    [index, review.id],
  );

  const back = useCallback(() => applyHistory(useTabs.getState().step(-1)), [applyHistory]);
  const forward = useCallback(() => applyHistory(useTabs.getState().step(1)), [applyHistory]);
  const jump = useCallback((i: number) => applyHistory(useTabs.getState().jump(i)), [applyHistory]);

  return useMemo(() => ({ openSymbol, openTarget, activateTab, back, forward, jump }), [openSymbol, openTarget, activateTab, back, forward, jump]);
}

/**
 * Bağlantı davranışı: tık → öne gelen sekme; Ctrl/Cmd+tık ya da orta tık → arka plan sekmesi.
 * Orta tıkta tarayıcının otomatik kaydırması engellenir.
 */
export function linkProps(open: (background: boolean) => void) {
  return {
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      open(e.ctrlKey || e.metaKey);
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      open(true);
    },
    onMouseDown: (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    },
  };
}

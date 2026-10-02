import { useEffect } from 'react';
import type { Tab } from '../lib/route';
import { navigationOrder, nextUnseen, planView, stepFile } from '../lib/selectors';
import { useReviewCtx } from '../features/workspace/ReviewContext';
import { useProgress } from '../state/progressStore';
import { useUi } from '../state/uiStore';
import { useSetTab } from './useNavigation';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** j/k: plan içinde sonraki/önceki, n: sonraki görülmemiş, v: görüldü, /: arama, g: etki haritası, ?: yardım. */
export function useShortcuts(tab: Tab): void {
  const { review, index } = useReviewCtx();
  const setTab = useSetTab();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      const ui = useUi.getState();
      if (ui.helpOpen) return;
      const progress = useProgress.getState();
      const order = navigationOrder(planView(review, index, ui.filters));
      const current = ui.selectedFileId;
      const go = (id: string | undefined) => {
        if (!id) return;
        ui.selectFile(id);
        if (tab !== 'workspace') setTab('workspace');
      };
      switch (e.key) {
        case 'j':
          go(stepFile(order, current, 1));
          break;
        case 'k':
          go(stepFile(order, current, -1));
          break;
        case 'n':
          go(nextUnseen(order, current, progress.seen));
          break;
        case 'v':
          if (current) progress.toggleSeen(current);
          break;
        case '/':
          e.preventDefault();
          if (tab !== 'workspace') setTab('workspace');
          ui.focusSearch();
          break;
        case 'g':
          setTab(tab === 'graph' ? 'workspace' : 'graph');
          break;
        case '?':
          ui.setHelpOpen(true);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, index, tab, setTab]);
}

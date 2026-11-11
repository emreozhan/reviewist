import { useCallback, useMemo } from 'react';
import { activeTab, neighborTab } from '../lib/tabs';
import { useTabs } from '../state/tabsStore';
import { useUi } from '../state/uiStore';
import { useCodeNav } from './useCodeNav';

/** Sekme komutları (sekme çubuğu ve klavye kısayolları ortak kullanır). */
export function useTabCommands() {
  const nav = useCodeNav();

  /** Etkin sekme değiştiyse yenisinin seçimini çalışma alanına uygular; sekme kalmadıysa seçimi temizler. */
  const settle = useCallback(
    (previousActive: string | null) => {
      const st = useTabs.getState();
      if (st.activeKey === previousActive) return;
      const next = activeTab(st);
      if (next) nav.activateTab(next, { skipHistory: true });
      else useUi.getState().clearSelection();
    },
    [nav],
  );

  const close = useCallback(
    (key: string) => {
      const before = useTabs.getState().activeKey;
      useTabs.getState().close(key);
      settle(before);
    },
    [settle],
  );

  const closeOthers = useCallback(
    (key: string) => {
      const before = useTabs.getState().activeKey;
      useTabs.getState().closeOthers(key);
      settle(before);
    },
    [settle],
  );

  const closeAll = useCallback(() => {
    const st = useTabs.getState();
    for (const t of st.tabs) useTabs.getState().close(t.key);
    useUi.getState().clearSelection();
  }, []);

  const cycle = useCallback(
    (dir: 1 | -1) => {
      const st = useTabs.getState();
      const key = neighborTab(st, dir);
      const tab = key ? st.tabs.find((t) => t.key === key) : undefined;
      if (tab && key !== st.activeKey) nav.activateTab(tab);
    },
    [nav],
  );

  const closeActive = useCallback(() => {
    const key = useTabs.getState().activeKey;
    if (key) close(key);
  }, [close]);

  return useMemo(() => ({ close, closeOthers, closeAll, cycle, closeActive }), [close, closeOthers, closeAll, cycle, closeActive]);
}

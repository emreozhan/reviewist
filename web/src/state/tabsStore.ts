import { create } from 'zustand';
import type { HistoryEntry, OpenSpec, TabsState } from '../lib/tabs';
import {
  activateTab,
  closeOtherTabs,
  closeTab,
  EMPTY_TABS,
  focusInTab,
  jumpHistory,
  moveTab,
  openTab,
  pinTab,
  reviveTabs,
  serializeTabs,
  stepHistory,
  tabKey,
} from '../lib/tabs';

/** Açık sekmeler ve gezinme geçmişi; review başına (stableKey) localStorage'da saklanır. */
interface TabsStore extends TabsState {
  storageKey: string | null;
  init: (storageKey: string, isKnownDiffFile: (path: string) => boolean) => void;
  open: (spec: OpenSpec, opts: { preview: boolean; activate: boolean; skipHistory?: boolean }) => void;
  activate: (key: string, opts?: { skipHistory?: boolean }) => void;
  focus: (key: string, focus: { symbolId?: string; line?: number; endLine?: number; crumb?: string }, record?: boolean) => void;
  pin: (key: string) => void;
  /** Bu yoldaki (yeni taraf) sekmeyi kalıcı yapar (işaretleme/not). */
  pinPath: (path: string) => void;
  close: (key: string) => void;
  closeOthers: (key: string) => void;
  move: (from: string, to: string) => void;
  /** Geçmişte bir adım (imleci taşır); uygulanacak kaydı döndürür. */
  step: (dir: 1 | -1) => HistoryEntry | null;
  jump: (index: number) => HistoryEntry | null;
}

let tickSeq = 0;
/** Odak istekleri için artan sayaç (aynı sembole tekrar gitmek kaydırmayı yeniden tetikler). */
export const nextTick = (): number => ++tickSeq;

function save(key: string | null, state: TabsState): void {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(serializeTabs(state)));
  } catch (error) {
    console.warn('Sekmeler kaydedilemedi', error);
  }
}

function load(key: string, isKnownDiffFile: (path: string) => boolean): TabsState {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? reviveTabs(JSON.parse(raw) as unknown, isKnownDiffFile) : EMPTY_TABS;
  } catch (error) {
    console.warn('Kayıtlı sekmeler okunamadı', error);
    return EMPTY_TABS;
  }
}

const pick = (s: TabsState): TabsState => ({ tabs: s.tabs, activeKey: s.activeKey, history: s.history, cursor: s.cursor });

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useTabs = create<TabsStore>((set, get) => {
  const apply = (next: TabsState) => {
    const cur = pick(get());
    if (next.tabs === cur.tabs && next.activeKey === cur.activeKey && next.history === cur.history && next.cursor === cur.cursor) return;
    set(next);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(get().storageKey, pick(get())), 120);
  };
  return {
    ...EMPTY_TABS,
    storageKey: null,
    init: (storageKey, isKnownDiffFile) => {
      if (get().storageKey === storageKey) return;
      set({ storageKey, ...load(storageKey, isKnownDiffFile) });
    },
    open: (spec, opts) => apply(openTab(pick(get()), spec, { ...opts, tick: nextTick() })),
    activate: (key, opts) => apply(activateTab(pick(get()), key, opts)),
    focus: (key, focus, record = true) => apply(focusInTab(pick(get()), key, { ...focus, tick: nextTick() }, record)),
    pin: (key) => apply(pinTab(pick(get()), key)),
    pinPath: (path) => apply(pinTab(pick(get()), tabKey(path))),
    close: (key) => apply(closeTab(pick(get()), key)),
    closeOthers: (key) => apply(closeOtherTabs(pick(get()), key)),
    move: (from, to) => apply(moveTab(pick(get()), from, to)),
    step: (dir) => {
      const r = stepHistory(pick(get()), dir);
      if (!r) return null;
      apply(r.state);
      return r.entry;
    },
    jump: (index) => {
      const r = jumpHistory(pick(get()), index);
      if (!r) return null;
      apply(r.state);
      return r.entry;
    },
  };
});

/** Review başına sekme anahtarı. */
export function tabsStorageKey(stableKeyOrId: string): string {
  return `reviewist:tabs:${stableKeyOrId}`;
}

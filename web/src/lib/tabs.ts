/**
 * IDE tarzı sekmeler ve gezinme geçmişi: saf durum geçişleri (React/zustand'dan bağımsız, birim testli).
 *
 * Sekme = bir dosya (sınıf) + odaklanılan sembol. Aynı dosya iki kez açılmaz (anahtar: taraf + yol).
 * Önizleme sekmesi (VS Code davranışı): gezginden tek tıklama onu açar; sonraki tek tıklama aynı sekmeyi değiştirir.
 * Kalıcı açma (metoda tıklama, çift tık, işaretleme) sekmeyi sabitler.
 */
export type TabSide = 'old' | 'new';

export interface EditorTab {
  /** `${side}:${path}` */
  key: string;
  path: string;
  side: TabSide;
  /** Dosya bu review'un değişen dosyalarından biri mi (değilse salt okunur Kaynak görünümü). */
  inDiff: boolean;
  /** Sekme başlığı: sınıf adı ya da dosya adı. */
  label: string;
  typeId?: string;
  /** Odaklanılan sembol. */
  symbolId?: string;
  /** Odak satırı (yeni tarafta; silinmiş sembolde eski tarafta). */
  line?: number;
  /** Odak bildirim aralığının sonu (Kaynak görünümünde vurgu için). */
  endLine?: number;
  /** Odak isteği sayacı: aynı sembole tekrar gidilince kaydırma yeniden tetiklenir. */
  tick: number;
  preview: boolean;
}

export interface HistoryEntry {
  key: string;
  path: string;
  side: TabSide;
  inDiff: boolean;
  /** Sekme başlığı (sınıf). */
  label: string;
  typeId?: string;
  symbolId?: string;
  /** Kırıntı izinde gösterilen kısa ad: 'AbstractNotifier.notify'. */
  crumb: string;
  line?: number;
  endLine?: number;
}

export interface TabsState {
  tabs: EditorTab[];
  activeKey: string | null;
  history: HistoryEntry[];
  /** Geçmişte bulunulan konum (history indeksi; boşsa -1). */
  cursor: number;
}

export interface OpenSpec {
  path: string;
  side?: TabSide;
  inDiff: boolean;
  label: string;
  typeId?: string;
  symbolId?: string;
  /** Kırıntı izi metni; verilmezse sekme başlığı. */
  crumb?: string;
  line?: number;
  endLine?: number;
}

export interface OpenOptions {
  /** Önizleme sekmesi olarak aç (mevcut önizlemeyi değiştirir). */
  preview: boolean;
  /** Öne getir (false: arka planda aç). */
  activate: boolean;
  /** Odak sayacı (çağıran artırır). */
  tick: number;
  /** Geçmişe kayıt ekleme (geri/ileri ile uygulanan kayıtlar için). */
  skipHistory?: boolean;
}

export const MAX_TABS = 30;
export const MAX_HISTORY = 60;

export const EMPTY_TABS: TabsState = { tabs: [], activeKey: null, history: [], cursor: -1 };

export function tabKey(path: string, side: TabSide = 'new'): string {
  return `${side}:${path}`;
}

export function activeTab(state: TabsState): EditorTab | undefined {
  return state.activeKey ? state.tabs.find((t) => t.key === state.activeKey) : undefined;
}

function entryOf(tab: EditorTab, crumb?: string): HistoryEntry {
  return {
    key: tab.key,
    path: tab.path,
    side: tab.side,
    inDiff: tab.inDiff,
    label: tab.label,
    typeId: tab.typeId,
    symbolId: tab.symbolId,
    crumb: crumb ?? tab.label,
    line: tab.line,
    endLine: tab.endLine,
  };
}

/**
 * Geçmişe kayıt ekler. Aynı sekme + aynı sembol tekrar eklenmez (yalnız satırı güncellenir);
 * aynı sekmede sembolsüz kayıt da eklenmez (dosya içi seçim temizliği iz bırakmaz).
 * İleri kayıtlar (geri gidildikten sonra yeni atlama) atılır.
 */
export function pushHistory(state: TabsState, entry: HistoryEntry): TabsState {
  const cur = state.history[state.cursor];
  if (cur && cur.key === entry.key && (cur.symbolId === entry.symbolId || entry.symbolId === undefined)) {
    if (entry.symbolId === undefined) return state;
    const line = entry.line ?? cur.line;
    const endLine = entry.line !== undefined ? entry.endLine : cur.endLine;
    if (cur.line === line && cur.endLine === endLine && cur.crumb === entry.crumb) return state;
    const history = state.history.slice();
    history[state.cursor] = { ...cur, line, endLine, crumb: entry.crumb };
    return { ...state, history };
  }
  let history = [...state.history.slice(0, state.cursor + 1), entry];
  if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
  return { ...state, history, cursor: history.length - 1 };
}

function insertAfterActive(tabs: EditorTab[], activeKey: string | null, tab: EditorTab): EditorTab[] {
  const at = activeKey ? tabs.findIndex((t) => t.key === activeKey) : -1;
  const next = tabs.slice();
  next.splice(at < 0 ? next.length : at + 1, 0, tab);
  return next;
}

/** Sekme sayısı sınırı: etkin ve hedef dışındaki en soldaki önizleme, yoksa en soldaki sekme kapanır. */
function enforceCap(tabs: EditorTab[], keep: ReadonlySet<string>): EditorTab[] {
  let next = tabs;
  while (next.length > MAX_TABS) {
    const victim = next.find((t) => t.preview && !keep.has(t.key)) ?? next.find((t) => !keep.has(t.key));
    if (!victim) break;
    next = next.filter((t) => t !== victim);
  }
  return next;
}

/** Dosyayı sekmede açar (varsa ona geçer ve odağı günceller). */
export function openTab(state: TabsState, spec: OpenSpec, opts: OpenOptions): TabsState {
  const side = spec.side ?? 'new';
  const key = tabKey(spec.path, side);
  const existing = state.tabs.find((t) => t.key === key);
  const hasFocus = spec.symbolId !== undefined || spec.line !== undefined;
  let tabs: EditorTab[];
  let tab: EditorTab;
  if (existing) {
    tab = {
      ...existing,
      inDiff: spec.inDiff,
      label: spec.label || existing.label,
      typeId: spec.typeId ?? existing.typeId,
      symbolId: hasFocus ? spec.symbolId : existing.symbolId,
      line: hasFocus ? spec.line : existing.line,
      endLine: hasFocus ? spec.endLine : existing.endLine,
      tick: hasFocus ? opts.tick : existing.tick,
      preview: existing.preview && opts.preview,
    };
    tabs = state.tabs.map((t) => (t.key === key ? tab : t));
  } else {
    tab = {
      key,
      path: spec.path,
      side,
      inDiff: spec.inDiff,
      label: spec.label,
      typeId: spec.typeId,
      symbolId: spec.symbolId,
      line: spec.line,
      endLine: spec.endLine,
      tick: opts.tick,
      preview: opts.preview,
    };
    const previewAt = opts.preview ? state.tabs.findIndex((t) => t.preview) : -1;
    if (previewAt >= 0) {
      tabs = state.tabs.slice();
      tabs[previewAt] = tab;
    } else {
      tabs = insertAfterActive(state.tabs, state.activeKey, tab);
    }
  }
  const activeKey = opts.activate ? key : state.activeKey;
  // Etkin sekme önizleme tarafından değiştirildiyse (arka planda açılmadıysa) etkin anahtar zaten günceldir.
  const stillActive = activeKey && tabs.some((t) => t.key === activeKey) ? activeKey : key;
  tabs = enforceCap(tabs, new Set([stillActive, key]));
  let next: TabsState = { ...state, tabs, activeKey: stillActive };
  if (opts.activate && !opts.skipHistory) next = pushHistory(next, entryOf(tab, spec.crumb));
  return next;
}

/** Var olan sekmeye geçer (sekme çubuğu, klavye). */
export function activateTab(state: TabsState, key: string, opts?: { skipHistory?: boolean }): TabsState {
  const tab = state.tabs.find((t) => t.key === key);
  if (!tab) return state;
  const next = { ...state, activeKey: key };
  return opts?.skipHistory ? next : pushHistory(next, entryOf(tab));
}

/** Etkin sekmenin odağını günceller (dosya içinde sembol seçimi). */
export function focusInTab(state: TabsState, key: string, focus: { symbolId?: string; line?: number; endLine?: number; crumb?: string; tick: number }, record = true): TabsState {
  const tab = state.tabs.find((t) => t.key === key);
  if (!tab) return state;
  const updated: EditorTab = { ...tab, symbolId: focus.symbolId, line: focus.line, endLine: focus.endLine, tick: focus.tick };
  const next = { ...state, tabs: state.tabs.map((t) => (t.key === key ? updated : t)) };
  return record && state.activeKey === key ? pushHistory(next, entryOf(updated, focus.crumb)) : next;
}

export function pinTab(state: TabsState, key: string): TabsState {
  const tab = state.tabs.find((t) => t.key === key);
  if (!tab || !tab.preview) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.key === key ? { ...t, preview: false } : t)) };
}

/** Sekmeyi kapatır; etkinse sağındaki (yoksa solundaki) öne gelir. Geçmiş korunur (Geri ile yeniden açılabilir). */
export function closeTab(state: TabsState, key: string): TabsState {
  const at = state.tabs.findIndex((t) => t.key === key);
  if (at < 0) return state;
  const tabs = state.tabs.filter((t) => t.key !== key);
  let activeKey = state.activeKey;
  if (activeKey === key) activeKey = (tabs[at] ?? tabs[at - 1])?.key ?? null;
  return { ...state, tabs, activeKey };
}

export function closeOtherTabs(state: TabsState, key: string): TabsState {
  const tab = state.tabs.find((t) => t.key === key);
  if (!tab) return state;
  return { ...state, tabs: [tab], activeKey: key };
}

/** Sürükle-bırak sıralama: `from` anahtarlı sekme `to` anahtarlı sekmenin yerine taşınır. */
export function moveTab(state: TabsState, from: string, to: string): TabsState {
  if (from === to) return state;
  const fi = state.tabs.findIndex((t) => t.key === from);
  const ti = state.tabs.findIndex((t) => t.key === to);
  if (fi < 0 || ti < 0) return state;
  const tabs = state.tabs.slice();
  const [moved] = tabs.splice(fi, 1);
  if (!moved) return state;
  tabs.splice(ti, 0, moved);
  return { ...state, tabs };
}

/** Sekme çubuğunda komşu sekme (döngüsel). */
export function neighborTab(state: TabsState, dir: 1 | -1): string | null {
  if (state.tabs.length === 0) return null;
  const at = state.tabs.findIndex((t) => t.key === state.activeKey);
  const i = at < 0 ? 0 : (at + dir + state.tabs.length) % state.tabs.length;
  return state.tabs[i]?.key ?? null;
}

export function canGo(state: TabsState, dir: 1 | -1): boolean {
  const i = state.cursor + dir;
  return i >= 0 && i < state.history.length;
}

/** Geçmişte `index` konumuna gider; uygulanacak kaydı döndürür (sekmeyi açmak/odaklamak çağıranın işi). */
export function jumpHistory(state: TabsState, index: number): { state: TabsState; entry: HistoryEntry } | null {
  const entry = state.history[index];
  if (!entry || index === state.cursor) return null;
  return { state: { ...state, cursor: index }, entry };
}

export function stepHistory(state: TabsState, dir: 1 | -1): { state: TabsState; entry: HistoryEntry } | null {
  return canGo(state, dir) ? jumpHistory(state, state.cursor + dir) : null;
}

/** Kırıntı izi: imlece kadar son `max` kayıt (+ varsa ileri kayıtlar ayrı işaretlenir). */
export function breadcrumb(state: TabsState, max = 6): { index: number; entry: HistoryEntry; current: boolean; forward: boolean }[] {
  const from = Math.max(0, state.cursor - max + 1);
  const to = Math.min(state.history.length, state.cursor + 3);
  const out: { index: number; entry: HistoryEntry; current: boolean; forward: boolean }[] = [];
  for (let i = from; i < to; i++) {
    const entry = state.history[i];
    if (entry) out.push({ index: i, entry, current: i === state.cursor, forward: i > state.cursor });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kalıcılık (review başına localStorage)
// ---------------------------------------------------------------------------

const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const sideOf = (v: unknown): TabSide => (v === 'old' ? 'old' : 'new');

function reviveTab(v: unknown): EditorTab | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.path) || !isStr(o.label)) return null;
  const side = sideOf(o.side);
  return {
    key: tabKey(o.path, side),
    path: o.path,
    side,
    inDiff: o.inDiff === true,
    label: o.label,
    typeId: optStr(o.typeId),
    symbolId: optStr(o.symbolId),
    line: optNum(o.line),
    endLine: optNum(o.endLine),
    tick: 0,
    preview: o.preview === true,
  };
}

function reviveEntry(v: unknown): HistoryEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.path) || !isStr(o.label)) return null;
  const side = sideOf(o.side);
  return {
    key: tabKey(o.path, side),
    path: o.path,
    side,
    inDiff: o.inDiff === true,
    label: o.label,
    typeId: optStr(o.typeId),
    symbolId: optStr(o.symbolId),
    crumb: optStr(o.crumb) ?? o.label,
    line: optNum(o.line),
    endLine: optNum(o.endLine),
  };
}

/** Kayıtlı durumu doğrular; `isKnownDiffFile` false dönen diff içi sekmeler (review değişti) atılır. */
export function reviveTabs(raw: unknown, isKnownDiffFile: (path: string) => boolean): TabsState {
  if (typeof raw !== 'object' || raw === null) return EMPTY_TABS;
  const o = raw as Record<string, unknown>;
  const valid = (t: { inDiff: boolean; path: string }) => !t.inDiff || isKnownDiffFile(t.path);
  const seen = new Set<string>();
  const tabs = (Array.isArray(o.tabs) ? o.tabs : [])
    .map(reviveTab)
    .filter((t): t is EditorTab => t !== null && valid(t) && !seen.has(t.key) && !!seen.add(t.key))
    .slice(0, MAX_TABS);
  const history = (Array.isArray(o.history) ? o.history : [])
    .map(reviveEntry)
    .filter((e): e is HistoryEntry => e !== null && valid(e))
    .slice(-MAX_HISTORY);
  const activeKey = isStr(o.activeKey) && tabs.some((t) => t.key === o.activeKey) ? o.activeKey : (tabs[0]?.key ?? null);
  const rawCursor = optNum(o.cursor) ?? history.length - 1;
  const cursor = Math.min(history.length - 1, Math.max(history.length > 0 ? 0 : -1, Math.round(rawCursor)));
  return { tabs, activeKey, history, cursor };
}

/** Kalıcılık için sadeleştirilmiş durum (odak sayacı yazılmaz). */
export function serializeTabs(state: TabsState): unknown {
  return {
    tabs: state.tabs.map(({ tick: _tick, key: _key, ...rest }) => rest),
    activeKey: state.activeKey,
    history: state.history.map(({ key: _key, ...rest }) => rest),
    cursor: state.cursor,
  };
}

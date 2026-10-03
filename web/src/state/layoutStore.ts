import { create } from 'zustand';
import type { SidePanel } from '../lib/panelSizes';
import { clampHeight, PANEL_LIMITS, validWidth } from '../lib/panelSizes';

/**
 * Çalışma alanı yerleşimi: yan panel genişlikleri, daraltma, genişletme, odak modu,
 * akordiyon bölümlerinin açık/kapalı durumu ve sürüklenen bölüm yükseklikleri. localStorage'da saklanır.
 */
interface LayoutState {
  navW: number;
  inspW: number;
  navCollapsed: boolean;
  inspCollapsed: boolean;
  /** Geçici olarak en geniş haline getirilmiş yan panel. */
  wide: SidePanel | null;
  /** Orta panel odak modu: yan paneller ve üst göstergeler gizlenir. */
  focusMode: boolean;
  /** Kapalı akordiyon bölümleri (anahtar → true). */
  closed: Record<string, boolean>;
  /** Kullanıcının sürüklediği bölüm yükseklikleri (piksel). */
  heights: Record<string, number>;

  setWidth: (panel: SidePanel, w: number) => void;
  setCollapsed: (panel: SidePanel, v: boolean) => void;
  toggleCollapsed: (panel: SidePanel) => void;
  toggleWide: (panel: SidePanel) => void;
  setFocusMode: (v: boolean) => void;
  toggleFocusMode: () => void;
  isOpen: (key: string, defaultOpen?: boolean) => boolean;
  setOpen: (key: string, open: boolean) => void;
  setHeight: (key: string, h: number | null) => void;
}

const KEY = 'reviewist:layout';

interface Persisted {
  navW: number;
  inspW: number;
  navCollapsed?: boolean;
  inspCollapsed?: boolean;
  closed: Record<string, boolean>;
  heights: Record<string, number>;
}

const narrow = (px: number) => typeof window !== 'undefined' && window.innerWidth < px;

function readPersisted(): Partial<Persisted> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? (v as Partial<Persisted>) : {};
  } catch (error) {
    console.warn('Yerleşim tercihleri okunamadı', error);
    return {};
  }
}

function boolRecord(v: unknown): Record<string, boolean> {
  if (typeof v !== 'object' || v === null) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) as Record<string, boolean>;
}

function heightRecord(v: unknown): Record<string, number> {
  if (typeof v !== 'object' || v === null) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number' && Number.isFinite(x)).map(([k, x]) => [k, clampHeight(x as number)]));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(s: LayoutState): void {
  if (saveTimer) clearTimeout(saveTimer);
  // Sürükleme sırasında her harekette yazmamak için kısa gecikme.
  saveTimer = setTimeout(() => {
    try {
      const data: Persisted = { navW: s.navW, inspW: s.inspW, navCollapsed: s.navCollapsed, inspCollapsed: s.inspCollapsed, closed: s.closed, heights: s.heights };
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('Yerleşim tercihleri kaydedilemedi', error);
    }
  }, 150);
}

const saved = typeof window !== 'undefined' ? readPersisted() : {};

export const useLayout = create<LayoutState>((set, get) => {
  const update = (patch: Partial<LayoutState>) => {
    set(patch);
    persist(get());
  };
  const flag = (panel: SidePanel): 'navCollapsed' | 'inspCollapsed' => (panel === 'nav' ? 'navCollapsed' : 'inspCollapsed');
  return {
    navW: validWidth('nav', saved.navW),
    inspW: validWidth('insp', saved.inspW),
    navCollapsed: typeof saved.navCollapsed === 'boolean' ? saved.navCollapsed : narrow(900),
    inspCollapsed: typeof saved.inspCollapsed === 'boolean' ? saved.inspCollapsed : narrow(1200),
    wide: null,
    focusMode: false,
    closed: boolRecord(saved.closed),
    heights: heightRecord(saved.heights),

    setWidth: (panel, w) => update(panel === 'nav' ? { navW: w, wide: get().wide === 'nav' ? null : get().wide } : { inspW: w, wide: get().wide === 'insp' ? null : get().wide }),
    setCollapsed: (panel, v) => update({ [flag(panel)]: v, ...(v && get().wide === panel ? { wide: null } : {}) }),
    toggleCollapsed: (panel) => get().setCollapsed(panel, !get()[flag(panel)]),
    toggleWide: (panel) => update({ wide: get().wide === panel ? null : panel, [flag(panel)]: false, focusMode: false }),
    setFocusMode: (v) => set({ focusMode: v }),
    toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
    isOpen: (key, defaultOpen = true) => {
      const c = get().closed[key];
      return c === undefined ? defaultOpen : !c;
    },
    setOpen: (key, open) => update({ closed: { ...get().closed, [key]: !open } }),
    setHeight: (key, h) => {
      const heights = { ...get().heights };
      if (h === null) delete heights[key];
      else heights[key] = clampHeight(h);
      update({ heights });
    },
  };
});

/** Genişletilmiş yan panelin genişliği: kendi üst sınırı (ayrıca orta panel payı Workspace'te uygulanır). */
export function wideWidth(panel: SidePanel): number {
  return PANEL_LIMITS[panel].max;
}

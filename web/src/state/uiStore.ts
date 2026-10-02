import { create } from 'zustand';
import type { GraphFilter } from '../lib/graphLayout';
import type { NavFilters } from '../lib/selectors';
import { DEFAULT_FILTERS } from '../lib/selectors';

export type CenterView = 'structure' | 'diff';
export type DiffLayout = 'unified' | 'split';
export type NavMode = 'plan' | 'layers' | 'groups' | 'findings';

export interface FocusLine {
  fileId: string;
  line: number;
  /** Aynı satıra tekrar gitmeyi tetiklemek için artan sayaç. */
  tick: number;
}

interface UiState {
  reviewId: string | null;
  selectedFileId: string | null;
  selectedSymbolId: string | null;
  /** null: dosya türüne göre otomatik (Java → Yapı, diğer → Diff). */
  centerView: CenterView | null;
  diffLayout: DiffLayout;
  navMode: NavMode;
  filters: NavFilters;
  showUnchanged: boolean;
  showCosmeticSection: boolean;
  navCollapsed: boolean;
  inspectorCollapsed: boolean;
  helpOpen: boolean;
  focusLine: FocusLine | null;
  graphFilter: GraphFilter | null;
  searchFocusTick: number;

  resetForReview: (reviewId: string) => void;
  selectFile: (fileId: string, opts?: { keepSymbol?: boolean }) => void;
  selectSymbol: (symbolId: string | null, fileId?: string) => void;
  goToLine: (fileId: string, line: number, symbolId?: string) => void;
  /** null: dosya türüne göre otomatik. */
  setCenterView: (v: CenterView | null) => void;
  setDiffLayout: (l: DiffLayout) => void;
  setNavMode: (m: NavMode) => void;
  setFilters: (patch: Partial<NavFilters>) => void;
  toggleShowUnchanged: () => void;
  toggleCosmeticSection: () => void;
  toggleNav: () => void;
  toggleInspector: () => void;
  setHelpOpen: (open: boolean) => void;
  setGraphFilter: (f: GraphFilter) => void;
  focusSearch: () => void;
}

const narrow = (px: number) => typeof window !== 'undefined' && window.innerWidth < px;

export const useUi = create<UiState>((set, get) => ({
  reviewId: null,
  selectedFileId: null,
  selectedSymbolId: null,
  centerView: null,
  diffLayout: 'unified',
  navMode: 'plan',
  filters: DEFAULT_FILTERS,
  showUnchanged: false,
  showCosmeticSection: false,
  navCollapsed: narrow(900),
  inspectorCollapsed: narrow(1200),
  helpOpen: false,
  focusLine: null,
  graphFilter: null,
  searchFocusTick: 0,

  resetForReview: (reviewId) => {
    if (get().reviewId === reviewId) return;
    set({ reviewId, selectedFileId: null, selectedSymbolId: null, centerView: null, focusLine: null, graphFilter: null });
  },
  selectFile: (fileId, opts) =>
    set((s) => ({
      selectedFileId: fileId,
      selectedSymbolId: opts?.keepSymbol ? s.selectedSymbolId : null,
      centerView: s.selectedFileId === fileId ? s.centerView : null,
    })),
  selectSymbol: (symbolId, fileId) =>
    set((s) => {
      const changingFile = fileId !== undefined && fileId !== s.selectedFileId;
      return {
        selectedSymbolId: symbolId,
        selectedFileId: fileId ?? s.selectedFileId,
        centerView: changingFile ? null : s.centerView,
      };
    }),
  goToLine: (fileId, line, symbolId) =>
    set((s) => ({
      selectedFileId: fileId,
      selectedSymbolId: symbolId ?? null,
      centerView: 'diff',
      focusLine: { fileId, line, tick: (s.focusLine?.tick ?? 0) + 1 },
    })),
  setCenterView: (v) => set({ centerView: v }),
  // Yan yana görünüm geniş alan ister: dar ekranlarda denetçi otomatik daraltılır (tekrar açılabilir).
  setDiffLayout: (l) => set((s) => ({ diffLayout: l, inspectorCollapsed: l === 'split' && narrow(1600) ? true : s.inspectorCollapsed })),
  setNavMode: (m) => set({ navMode: m }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  toggleShowUnchanged: () => set((s) => ({ showUnchanged: !s.showUnchanged })),
  toggleCosmeticSection: () => set((s) => ({ showCosmeticSection: !s.showCosmeticSection })),
  toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  setHelpOpen: (open) => set({ helpOpen: open }),
  setGraphFilter: (f) => set({ graphFilter: f }),
  focusSearch: () => set((s) => ({ searchFocusTick: s.searchFocusTick + 1, navCollapsed: false })),
}));

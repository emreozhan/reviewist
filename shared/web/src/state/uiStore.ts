import { create } from 'zustand';
import type { GraphFilter } from '../lib/graphLayout';
import type { FindingFilter, NavFilters } from '../lib/selectors';
import { DEFAULT_FILTERS, DEFAULT_FINDING_FILTER } from '../lib/selectors';
import { useLayout } from './layoutStore';

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
  /** Plan sonundaki katlı özet bölümlerinden açık olanlar ('cosmetic', 'lowrisk'). */
  openFolds: Record<string, boolean>;
  findingFilter: FindingFilter;
  helpOpen: boolean;
  focusLine: FocusLine | null;
  graphFilter: GraphFilter | null;
  searchFocusTick: number;
  /** İşlenmiş son arama odağı isteği (odak isteği tek seferliktir; arama kutusu yeniden bağlanınca tekrar odaklanmaz). */
  searchFocusHandled: number;
  /**
   * Her dosya/sembol seçiminde (aynı değer tekrar seçilse de) artar: sekme senkronu gezginden gelen
   * seçimi önizleme sekmesine çevirmek için bunu izler.
   */
  selectionSeq: number;

  resetForReview: (reviewId: string) => void;
  selectFile: (fileId: string, opts?: { keepSymbol?: boolean }) => void;
  selectSymbol: (symbolId: string | null, fileId?: string) => void;
  /** Seçimi temizler (tüm sekmeler kapandığında). */
  clearSelection: () => void;
  goToLine: (fileId: string, line: number, symbolId?: string) => void;
  /** Satıra gitme isteği işlendi: aynı dosyaya sonra dönülünce eski satıra kaydırılmaz. `tick` verilirse yalnız o istek temizlenir. */
  clearFocus: (tick?: number) => void;
  /** null: dosya türüne göre otomatik. */
  setCenterView: (v: CenterView | null) => void;
  setDiffLayout: (l: DiffLayout) => void;
  setNavMode: (m: NavMode) => void;
  setFilters: (patch: Partial<NavFilters>) => void;
  toggleShowUnchanged: () => void;
  toggleFold: (key: string) => void;
  setFindingFilter: (patch: Partial<FindingFilter>) => void;
  setHelpOpen: (open: boolean) => void;
  setGraphFilter: (f: GraphFilter) => void;
  focusSearch: () => void;
  /** Bekleyen arama odağı isteğini tüketir: bekleyen istek varsa true (yalnız bir kez). */
  consumeSearchFocus: () => boolean;
}

/** Odak istekleri için tekil sayaç (temizlendikten sonra da artmaya devam eder; tablo aynı tick'i iki kez işlemez). */
let focusSeq = 0;

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
  openFolds: {},
  findingFilter: DEFAULT_FINDING_FILTER,
  helpOpen: false,
  focusLine: null,
  graphFilter: null,
  searchFocusTick: 0,
  searchFocusHandled: 0,
  selectionSeq: 0,

  resetForReview: (reviewId) => {
    if (get().reviewId === reviewId) return;
    // Arama metni ve filtreler incelemeye özgüdür: başka incelemeye taşınmaz.
    set((s) => ({
      reviewId,
      selectedFileId: null,
      selectedSymbolId: null,
      centerView: null,
      focusLine: null,
      graphFilter: null,
      openFolds: {},
      filters: DEFAULT_FILTERS,
      findingFilter: DEFAULT_FINDING_FILTER,
      searchFocusHandled: s.searchFocusTick,
    }));
  },
  // Dosya seçimi yeni bir okuma niyetidir: bekleyen satır odağı düşer (j/k ile dönünce eski satıra kaymaz).
  selectFile: (fileId, opts) =>
    set((s) => ({
      selectedFileId: fileId,
      selectedSymbolId: opts?.keepSymbol ? s.selectedSymbolId : null,
      centerView: s.selectedFileId === fileId ? s.centerView : null,
      focusLine: null,
      selectionSeq: s.selectionSeq + 1,
    })),
  selectSymbol: (symbolId, fileId) =>
    set((s) => {
      const changingFile = fileId !== undefined && fileId !== s.selectedFileId;
      return {
        selectedSymbolId: symbolId,
        selectedFileId: fileId ?? s.selectedFileId,
        centerView: changingFile ? null : s.centerView,
        focusLine: changingFile ? null : s.focusLine,
        selectionSeq: s.selectionSeq + 1,
      };
    }),
  clearSelection: () => set({ selectedFileId: null, selectedSymbolId: null, focusLine: null, centerView: null }),
  goToLine: (fileId, line, symbolId) =>
    set((s) => ({
      selectedFileId: fileId,
      selectedSymbolId: symbolId ?? null,
      centerView: 'diff',
      focusLine: { fileId, line, tick: ++focusSeq },
      selectionSeq: s.selectionSeq + 1,
    })),
  clearFocus: (tick) =>
    set((s) => (s.focusLine && (tick === undefined || s.focusLine.tick === tick) ? { focusLine: null } : s)),
  setCenterView: (v) => set({ centerView: v }),
  // Yan yana görünüm geniş alan ister: dar ekranlarda denetçi otomatik daraltılır (tekrar açılabilir).
  setDiffLayout: (l) => {
    if (l === 'split' && narrow(1600) && get().diffLayout !== 'split') useLayout.getState().setCollapsed('insp', true);
    set({ diffLayout: l });
  },
  setNavMode: (m) => set({ navMode: m }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  toggleShowUnchanged: () => set((s) => ({ showUnchanged: !s.showUnchanged })),
  toggleFold: (key) => set((s) => ({ openFolds: { ...s.openFolds, [key]: !s.openFolds[key] } })),
  setFindingFilter: (patch) => set((s) => ({ findingFilter: { ...s.findingFilter, ...patch } })),
  setHelpOpen: (open) => set({ helpOpen: open }),
  setGraphFilter: (f) => set({ graphFilter: f }),
  focusSearch: () => {
    const layout = useLayout.getState();
    layout.setCollapsed('nav', false);
    layout.setFocusMode(false);
    set((s) => ({ searchFocusTick: s.searchFocusTick + 1 }));
  },
  consumeSearchFocus: () => {
    const { searchFocusTick, searchFocusHandled } = get();
    if (searchFocusTick <= searchFocusHandled) return false;
    set({ searchFocusHandled: searchFocusTick });
    return true;
  },
}));

import { create } from 'zustand';
import { loadStateMigrating, saveState } from '../lib/persistence';

/** Görüldü işaretleri ve notlar; review başına localStorage'da saklanır. */
interface ProgressState {
  key: string | null;
  seen: Record<string, boolean>;
  notes: Record<string, string>;
  saveFailed: boolean;
  /** `legacyKey`: eski anahtar; yeni anahtarda kayıt yoksa oradan bir kerelik taşınır. */
  init: (key: string, legacyKey?: string) => void;
  toggleSeen: (fileId: string) => void;
  setSeen: (fileId: string, value: boolean) => void;
  setNote: (noteKey: string, text: string) => void;
}

export const useProgress = create<ProgressState>((set, get) => {
  const persist = () => {
    const { key, seen, notes } = get();
    if (!key) return;
    const ok = saveState(key, { seen, notes });
    if (ok === get().saveFailed) set({ saveFailed: !ok });
  };
  return {
    key: null,
    seen: {},
    notes: {},
    saveFailed: false,
    init: (key, legacyKey) => {
      if (get().key === key) return;
      const state = loadStateMigrating(key, legacyKey ?? key);
      set({ key, seen: state.seen, notes: state.notes, saveFailed: false });
    },
    toggleSeen: (fileId) => {
      set((s) => ({ seen: { ...s.seen, [fileId]: !s.seen[fileId] } }));
      persist();
    },
    setSeen: (fileId, value) => {
      set((s) => ({ seen: { ...s.seen, [fileId]: value } }));
      persist();
    },
    setNote: (noteKey, text) => {
      set((s) => ({ notes: { ...s.notes, [noteKey]: text } }));
      persist();
    },
  };
});

import { create } from 'zustand';
import type { PersistedReviewState, ProgressPatch } from '../lib/persistence';
import { effectiveSeen, loadState, loadStateMigrating, updateState } from '../lib/persistence';

/**
 * Görüldü işaretleri ve notlar; inceleme başına localStorage'da saklanır.
 * `seen` etkin görüldü kümesidir: işaretlendikten sonra değişikliği farklılaşan dosya (parmak izi uyuşmuyor)
 * görülmedi sayılır ve `stale`'e girer. Aynı inceleme başka bir tarayıcı sekmesinde de açıksa her yazım diskteki
 * güncel durumla birleştirilir ve `storage` olayıyla bellek güncellenir.
 */
interface ProgressState {
  key: string | null;
  /** Diskteki biçimiyle kayıtlı durum. */
  stored: PersistedReviewState;
  /** Dosya id → güncel değişiklik parmak izi. */
  prints: Record<string, string>;
  seen: Record<string, boolean>;
  /** Görüldükten sonra değişen dosyalar. */
  stale: Record<string, boolean>;
  notes: Record<string, string>;
  saveFailed: boolean;
  /** Son durum değişikliğinin kaynağı: bu sekmenin yazımı ('local') ya da diskten okuma ('remote'). */
  origin: 'local' | 'remote';
  /** `legacyKey`: eski anahtar; yeni anahtarda kayıt yoksa oradan bir kerelik taşınır. `prints`: güncel parmak izleri. */
  init: (key: string, legacyKey?: string, prints?: Record<string, string>) => void;
  toggleSeen: (fileId: string) => void;
  setSeen: (fileId: string, value: boolean) => void;
  setNote: (noteKey: string, text: string) => void;
  /** Diskten yeniden okur (başka sekmenin yazdıkları). */
  reload: () => void;
}

function derive(stored: PersistedReviewState, prints: Record<string, string>) {
  const { seen, stale } = effectiveSeen(stored, prints);
  return { stored, seen, stale, notes: stored.notes };
}

export const useProgress = create<ProgressState>((set, get) => {
  const write = (patch: ProgressPatch) => {
    const { key, stored, prints } = get();
    if (!key) return;
    const { state, ok } = updateState(key, patch, stored);
    set({ ...derive(state, prints), saveFailed: !ok, origin: 'local' });
  };
  const setSeenValue = (fileId: string, value: boolean) => {
    const print = get().prints[fileId];
    write({ seen: { [fileId]: value ? { value, print } : { value } } });
  };
  return {
    key: null,
    stored: { seen: {}, notes: {} },
    prints: {},
    seen: {},
    stale: {},
    notes: {},
    saveFailed: false,
    origin: 'remote',
    init: (key, legacyKey, prints = {}) => {
      if (get().key === key && get().prints === prints) return;
      const stored = loadStateMigrating(key, legacyKey ?? key);
      set({ key, prints, ...derive(stored, prints), saveFailed: false, origin: 'remote' });
    },
    toggleSeen: (fileId) => setSeenValue(fileId, !get().seen[fileId]),
    setSeen: (fileId, value) => setSeenValue(fileId, value),
    setNote: (noteKey, text) => write({ notes: { [noteKey]: text } }),
    reload: () => {
      const { key, prints } = get();
      if (!key) return;
      set({ ...derive(loadState(key), prints), origin: 'remote' });
    },
  };
});

// Başka bir tarayıcı sekmesi aynı incelemenin durumunu yazınca bellek güncellenir (kendi yazımlarımız olay üretmez).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const { key } = useProgress.getState();
    if (key && (e.key === key || e.key === null)) useProgress.getState().reload();
  });
}

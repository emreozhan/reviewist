import { create } from 'zustand';
import type { PeekEntry, PeekFrom, PeekRect } from '../lib/peekStack';
import { closeTopPeek, MAX_PEEK_DEPTH, pushPeek, returnToLevel, updatePeek } from '../lib/peekStack';

/**
 * Gözatma yığını (review başına bellekte; adrese yazılmaz). Açılışı tetikleyen öğe (odak dönüşü için)
 * serileştirilemediğinden durum dışında, pencere anahtarına göre tutulur.
 */
interface PeekStore {
  reviewId: string | null;
  entries: PeekEntry[];
  /** Kısa bilgi notu (derinlik sınırı aşıldı…); `noticeSeq` her notta artar. */
  notice: string | null;
  noticeSeq: number;
  reset: (reviewId: string) => void;
  push: (entry: PeekEntry, from: PeekFrom, returnFocus?: HTMLElement | null) => void;
  returnTo: (level: number) => void;
  closeTop: () => void;
  closeAll: () => void;
  setRect: (uid: string, rect: PeekRect | undefined) => void;
  toggleMaximized: (uid: string) => void;
  notify: (text: string) => void;
  clearNotice: () => void;
}

const returnFocusByUid = new Map<string, HTMLElement>();

/** Penceresi kapanınca odağın döneceği öğe (bağlantı). */
export function returnFocusOf(uid: string): HTMLElement | undefined {
  return returnFocusByUid.get(uid);
}

function prune(entries: readonly PeekEntry[]): void {
  const alive = new Set(entries.map((e) => e.uid));
  for (const uid of returnFocusByUid.keys()) if (!alive.has(uid)) returnFocusByUid.delete(uid);
}

let uidSeq = 0;
export const nextPeekUid = (): string => `pk${++uidSeq}`;

export const usePeek = create<PeekStore>((set, get) => {
  const apply = (entries: PeekEntry[]) => {
    // Kapanan pencerelerin odak hedefleri silinir; yığın boşalınca ilkininki odak dönüşü için korunur.
    set({ entries });
    if (entries.length > 0) prune(entries);
  };
  return {
    reviewId: null,
    entries: [],
    notice: null,
    noticeSeq: 0,
    reset: (reviewId) => {
      if (get().reviewId === reviewId) return;
      returnFocusByUid.clear();
      set({ reviewId, entries: [], notice: null });
    },
    push: (entry, from, returnFocus) => {
      const r = pushPeek(get().entries, entry, from);
      if (!r.reused && returnFocus) returnFocusByUid.set(entry.uid, returnFocus);
      apply(r.entries);
      if (r.dropped > 0) get().notify(`En fazla ${MAX_PEEK_DEPTH} gözatma seviyesi: en alttaki pencere kapatıldı.`);
    },
    returnTo: (level) => {
      const cur = get().entries;
      if (level >= cur.length - 1) return;
      apply(returnToLevel(cur, level));
    },
    closeTop: () => apply(closeTopPeek(get().entries)),
    closeAll: () => {
      if (get().entries.length > 0) set({ entries: [] });
    },
    setRect: (uid, rect) => set((s) => ({ entries: updatePeek(s.entries, uid, { rect }) })),
    toggleMaximized: (uid) =>
      set((s) => ({ entries: s.entries.map((e) => (e.uid === uid ? { ...e, maximized: !e.maximized } : e)) })),
    notify: (text) => set((s) => ({ notice: text, noticeSeq: s.noticeSeq + 1 })),
    clearNotice: () => set({ notice: null }),
  };
});

/** Yığın tamamen kapandığında odak dönüşü için ilk pencerenin bağlantısı (çağıran sonra temizler). */
export function takeRootReturnFocus(uid: string | undefined): HTMLElement | undefined {
  if (!uid) return undefined;
  const el = returnFocusByUid.get(uid);
  returnFocusByUid.clear();
  return el;
}

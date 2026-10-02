import { create } from 'zustand';
import type { LoadProgress } from '../lib/apiTypes';

/** Review yüklenme ilerlemesi (indirme / ayrıştırma / indeksleme), review kimliği başına. */
interface LoadState {
  byId: Record<string, LoadProgress | undefined>;
  report: (id: string, p: LoadProgress) => void;
  clear: (id: string) => void;
}

export const useLoad = create<LoadState>((set) => ({
  byId: {},
  report: (id, p) => set((s) => ({ byId: { ...s.byId, [id]: p } })),
  clear: (id) =>
    set((s) => {
      if (!(id in s.byId)) return s;
      const next = { ...s.byId };
      delete next[id];
      return { byId: next };
    }),
}));

/** '12,4 MB' biçimi (Türkçe ondalık ayırıcı). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} KB`;
  return `${(n / (1024 * 1024)).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/** İlerleme satırı metni. */
export function describeLoad(p: LoadProgress): string {
  if (p.phase === 'download') {
    return p.total ? `İndiriliyor: ${formatBytes(p.loaded)} / ${formatBytes(p.total)}` : `İndiriliyor: ${formatBytes(p.loaded)}`;
  }
  if (p.phase === 'parse') return `Ayrıştırılıyor (${formatBytes(p.loaded)})`;
  return 'Gezinme indeksi kuruluyor';
}

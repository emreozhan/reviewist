import { create } from 'zustand';

/** Kod gezinme uçlarının (outline/locate) sunucuda bulunup bulunmadığı; mod (mock/gerçek) başına. */
export type NavEndpoint = 'outline' | 'locate';

interface NavCapsState {
  missing: Record<string, true | undefined>;
  markMissing: (mock: boolean, endpoint: NavEndpoint) => void;
}

export const capKey = (mock: boolean, endpoint: NavEndpoint): string => `${mock ? 'mock' : 'real'}:${endpoint}`;

export const useNavCaps = create<NavCapsState>((set, get) => ({
  missing: {},
  markMissing: (mock, endpoint) => {
    const key = capKey(mock, endpoint);
    if (get().missing[key]) return;
    console.info(`Kod gezinme ucu bu sunucuda yok (${endpoint}); koddan gezinme kapatıldı.`);
    set((s) => ({ missing: { ...s.missing, [key]: true } }));
  },
}));

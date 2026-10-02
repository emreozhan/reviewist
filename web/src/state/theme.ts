import { create } from 'zustand';

export type ThemePref = 'system' | 'dark' | 'light';

const KEY = 'reviewist:theme';

function readPref(): ThemePref {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch (error) {
    console.warn('Tema tercihi okunamadı', error);
    return 'system';
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

interface ThemeState {
  pref: ThemePref;
  cycle: () => void;
}

const NEXT: Record<ThemePref, ThemePref> = { system: 'dark', dark: 'light', light: 'system' };

export const useTheme = create<ThemeState>((set, get) => ({
  pref: readPref(),
  cycle: () => {
    const pref = NEXT[get().pref];
    try {
      window.localStorage.setItem(KEY, pref);
    } catch (error) {
      console.warn('Tema tercihi kaydedilemedi', error);
    }
    applyTheme(pref);
    set({ pref });
  },
}));

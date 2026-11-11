import { create } from 'zustand';

function mockFromUrl(): boolean {
  try {
    const v = new URLSearchParams(window.location.search).get('mock');
    return v === '1' || v === 'true';
  } catch (error) {
    console.warn('URL okunamadı', error);
    return false;
  }
}

function setUrlFlag(on: boolean): void {
  const url = new URL(window.location.href);
  if (on) url.searchParams.set('mock', '1');
  else url.searchParams.delete('mock');
  window.history.replaceState(null, '', url.toString());
}

interface ApiModeState {
  mock: boolean;
  /** API'ye ulaşılamadığında kullanıcıya mock'a geçmeyi sor. */
  unreachablePrompt: boolean;
  enableMock: () => void;
  disableMock: () => void;
  reportUnreachable: () => void;
  dismissPrompt: () => void;
}

export const useApiMode = create<ApiModeState>((set, get) => ({
  mock: mockFromUrl(),
  unreachablePrompt: false,
  enableMock: () => {
    setUrlFlag(true);
    set({ mock: true, unreachablePrompt: false });
  },
  disableMock: () => {
    setUrlFlag(false);
    set({ mock: false });
  },
  reportUnreachable: () => {
    if (!get().mock) set({ unreachablePrompt: true });
  },
  dismissPrompt: () => set({ unreachablePrompt: false }),
}));

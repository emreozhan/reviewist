import { useEffect } from 'react';
import type { RefObject } from 'react';
import { isTypingTarget } from '../../lib/keyTarget';
import { usePeek } from '../../state/peekStore';
import { useTabs } from '../../state/tabsStore';
import { useUi } from '../../state/uiStore';

/**
 * Yığın klavyesi: Esc üstteki pencereyi kapatır; Alt+↑ / Alt+↓ odağı bir üst / alt seviyedeki pencereye taşır.
 * Açık menü ve modallar Esc'i yakalama aşamasında durdurur; burada kabarcık aşamasında dinlenir. Kapatılan Esc
 * `preventDefault` ile işaretlenir (odak modundan çıkma gibi genel kısayollar tetiklenmez).
 */
export function usePeekKeys(bodies: RefObject<Map<string, HTMLDivElement>>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useUi.getState().helpOpen) return;
      const { entries } = usePeek.getState();
      if (entries.length === 0) return;
      const inPeek = e.target instanceof Element && !!e.target.closest('.peek');
      if (isTypingTarget(e.target) && !inPeek) return;
      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        usePeek.getState().closeTop();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const current = document.activeElement?.closest<HTMLElement>('[data-peek-level]');
        const at = current ? Number(current.dataset.peekLevel) : entries.length - 1;
        const next = Math.max(0, Math.min(entries.length - 1, at + (e.key === 'ArrowUp' ? 1 : -1)));
        const target = entries[next];
        const body = target ? bodies.current?.get(target.uid) : undefined;
        if (!body) return;
        e.preventDefault();
        body.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bodies]);
}

/**
 * Yığın, okuma bağlamı değişince kapanır: etkin sekme değişti (pencereler etkin sekmenin önündedir) ya da
 * gezgin/j-k ile başka dosya seçildi.
 */
export function usePeekAutoClose(): void {
  useEffect(() => {
    const unsubTabs = useTabs.subscribe((s, prev) => {
      if (s.activeKey !== prev.activeKey) usePeek.getState().closeAll();
    });
    const unsubUi = useUi.subscribe((s, prev) => {
      if (s.selectedFileId !== prev.selectedFileId) usePeek.getState().closeAll();
    });
    return () => {
      unsubTabs();
      unsubUi();
    };
  }, []);
}

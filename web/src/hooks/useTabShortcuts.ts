import { useEffect } from 'react';
import { isTypingTarget } from '../lib/keyTarget';
import { tabCycleDelta } from '../lib/shortcutRows';
import { useLayout } from '../state/layoutStore';
import { usePeek } from '../state/peekStore';
import { useUi } from '../state/uiStore';
import { useCodeNav } from './useCodeNav';
import { useTabCommands } from './useTabCommands';

/**
 * Sekme ve gezinme kısayolları:
 *   Alt+← / Alt+→           gezinme geçmişinde geri / ileri
 *   Alt+] / Alt+[ (e.code; macOS ⌥), Alt+PageDown / Alt+PageUp, Ctrl+Tab / Ctrl+Shift+Tab   sonraki / önceki sekme
 *   Alt+W                   etkin sekmeyi kapat (tarayıcının Ctrl+W'siyle çakışmaz)
 *   f                       odak modu aç/kapat;  Esc  odak modundan çık (açık gözatma penceresi yoksa: tek Esc tek iş)
 */
export function useTabShortcuts(): void {
  const nav = useCodeNav();
  const cmd = useTabCommands();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useUi.getState().helpOpen) return;
      const typing = isTypingTarget(e.target);
      if (e.ctrlKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        cmd.cycle(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
        const delta = tabCycleDelta(e);
        if (e.key === 'ArrowLeft') nav.back();
        else if (e.key === 'ArrowRight') nav.forward();
        else if (delta !== 0) cmd.cycle(delta);
        else if (e.code === 'KeyW') cmd.closeActive();
        else return;
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing) return;
      const layout = useLayout.getState();
      if (e.key === 'f') {
        e.preventDefault();
        layout.toggleFocusMode();
      } else if (e.key === 'Escape' && layout.focusMode && usePeek.getState().entries.length === 0) {
        // Açık gözatma penceresi varsa Esc onu kapatır (usePeekKeys); odak modu ancak sonraki Esc'te kapanır.
        layout.setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, cmd]);
}

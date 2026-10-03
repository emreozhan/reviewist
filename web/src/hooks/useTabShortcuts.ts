import { useEffect } from 'react';
import { useLayout } from '../state/layoutStore';
import { useUi } from '../state/uiStore';
import { useCodeNav } from './useCodeNav';
import { useTabCommands } from './useTabCommands';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Sekme ve gezinme kısayolları:
 *   Alt+← / Alt+→           gezinme geçmişinde geri / ileri
 *   Ctrl+Tab / Ctrl+Shift+Tab, Alt+PageDown / Alt+PageUp   sonraki / önceki sekme
 *   Alt+W                   etkin sekmeyi kapat (tarayıcının Ctrl+W'siyle çakışmaz)
 *   f                       odak modu aç/kapat;  Esc  odak modundan çık
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
        if (e.key === 'ArrowLeft') nav.back();
        else if (e.key === 'ArrowRight') nav.forward();
        else if (e.key === 'PageDown') cmd.cycle(1);
        else if (e.key === 'PageUp') cmd.cycle(-1);
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
      } else if (e.key === 'Escape' && layout.focusMode) {
        layout.setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, cmd]);
}

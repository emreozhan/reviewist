import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Açılır menü davranışı: ilk menü öğesine odaklanır, dışarı tık ve Esc kapatır, kapanınca odak geri döner.
 * Esc yakalama aşamasında durdurulur (odak modu gibi genel Esc kısayolları tetiklenmez).
 */
export function usePopoverDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [ref]);
}

/** Menü içinde ↑/↓/Home/End ile öğeler arası gezinme. */
export function menuKeyNav(container: HTMLElement | null, key: string): boolean {
  const list = [...(container?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  if (list.length === 0) return false;
  const i = list.indexOf(document.activeElement as HTMLElement);
  let next: HTMLElement | undefined;
  if (key === 'ArrowDown') next = list[(i + 1) % list.length];
  else if (key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length];
  else if (key === 'Home') next = list[0];
  else if (key === 'End') next = list[list.length - 1];
  if (!next) return false;
  next.focus();
  return true;
}

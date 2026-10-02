import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useListWindow } from '../hooks/useListWindow';

interface VirtualListProps<T> {
  items: readonly T[];
  itemKey: (item: T) => string;
  /** Ölçülmemiş öğe için tahmini yükseklik (piksel). */
  estimate: (item: T) => number;
  renderItem: (item: T, index: number) => ReactNode;
  /** Bu anahtar değişince öğe görünür alana getirilir. */
  activeKey?: string | null;
  /** Bu sayıdan az öğe pencerelenmeden çizilir. */
  threshold?: number;
  className?: string;
  ariaLabel?: string;
  /** Sarmalayıcıya ek sınıf (ör. satır türüne göre). */
  itemClassName?: (item: T) => string | undefined;
}

/**
 * Binlerce satırlı listeler için pencereleme: en yakın dikey kaydıran üst öğeye göre yalnız görünür satırlar çizilir.
 * Her öğe `role="listitem"` sarmalayıcıda; yükseklikler ölçülerek tahminler düzeltilir.
 */
export function VirtualList<T>({ items, itemKey, estimate, renderItem, activeKey, threshold = 120, className, ariaLabel, itemClassName }: VirtualListProps<T>) {
  const keys = useMemo(() => items.map(itemKey), [items, itemKey]);
  const win = useListWindow(keys, (i) => { const it = items[i]; return it === undefined ? 32 : estimate(it); }, { threshold, activeKey });
  const visible = items.slice(win.start, win.end);

  return (
    <div ref={win.containerRef} className={className} role="list" aria-label={ariaLabel}>
      {win.padTop > 0 && <div aria-hidden="true" style={{ height: win.padTop }} />}
      {visible.map((item, i) => {
        const vi = win.start + i;
        const extra = itemClassName?.(item);
        return (
          <div key={keys[vi]} data-vi={vi} role="listitem" className={extra ? `vrow ${extra}` : 'vrow'}>
            {renderItem(item, vi)}
          </div>
        );
      })}
      {win.padBottom > 0 && <div aria-hidden="true" style={{ height: win.padBottom }} />}
    </div>
  );
}

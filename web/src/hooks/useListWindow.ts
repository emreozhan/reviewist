import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { scrollParent } from '../lib/scrollParent';
import { centeredOffset, prefixOffsets, windowRange } from '../lib/windowing';

/** Görünür alanın üstünde/altında hazır tutulan pay (piksel). */
const OVERSCAN_PX = 600;

export interface ListWindow {
  containerRef: RefObject<HTMLDivElement | null>;
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  windowed: boolean;
}

/**
 * Değişken yükseklikli liste pencereleme: yalnız görünür öğeler (+ pay) çizilir; üst/alt boşluk aralayıcılarla korunur.
 * Yükseklikler çizildikçe ölçülür (`[data-vi]` sarmalayıcıları), ölçülmeyenler `estimate` ile tahmin edilir.
 * `activeKey` değişince o öğe görünür alana getirilir (çizili değilse önce tahmini konuma atlanır).
 * Liste değişip etkin anahtar aynı kalırsa kaydırılmaz (kullanıcının konumu korunur).
 */
export function useListWindow(
  keys: readonly string[],
  estimate: (index: number) => number,
  opts: { threshold: number; activeKey?: string | null },
): ListWindow {
  const containerRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });
  const windowed = keys.length > opts.threshold;
  const estimateRef = useRef(estimate);
  estimateRef.current = estimate;

  const offsets = useMemo(() => {
    void version; // ölçüm değişince yeniden hesapla
    const h = new Array<number>(keys.length);
    for (let i = 0; i < keys.length; i++) h[i] = heights.current.get(keys[i] ?? '') ?? estimateRef.current(i);
    return prefixOffsets(h);
  }, [keys, version]);

  const syncView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scroller = scrollParent(el);
    const sr = scroller.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    const top = sr.top - cr.top;
    const height = scroller.clientHeight;
    setView((v) => (Math.abs(v.top - top) < 1 && v.height === height ? v : { top, height }));
  }, []);

  // Kaydırma ve boyut değişimini izle (genişlik değişince satır yükseklikleri yeniden ölçülür).
  useLayoutEffect(() => {
    if (!windowed) return;
    const el = containerRef.current;
    if (!el) return;
    const scroller = scrollParent(el);
    let raf = 0;
    const schedule = () => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          syncView();
        });
      }
    };
    syncView();
    const target: HTMLElement | Window = scroller === document.scrollingElement ? window : scroller;
    target.addEventListener('scroll', schedule, { passive: true });
    let lastWidth = scroller.clientWidth;
    const ro = new ResizeObserver(() => {
      if (scroller.clientWidth !== lastWidth) {
        lastWidth = scroller.clientWidth;
        heights.current.clear();
        setVersion((v) => v + 1);
      }
      schedule();
    });
    ro.observe(scroller);
    return () => {
      target.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [windowed, syncView]);

  const range = windowed ? windowRange(offsets, view.top, view.top + view.height, OVERSCAN_PX) : { start: 0, end: keys.length };

  // Çizilen öğeleri ölç.
  useLayoutEffect(() => {
    if (!windowed) return;
    const el = containerRef.current;
    if (!el) return;
    let changed = false;
    for (const child of el.querySelectorAll<HTMLElement>(':scope > [data-vi]')) {
      const key = keys[Number(child.dataset.vi)];
      if (key === undefined) continue;
      const h = child.getBoundingClientRect().height;
      if (h <= 0) continue;
      if (Math.abs((heights.current.get(key) ?? -1) - h) > 0.5) {
        heights.current.set(key, h);
        changed = true;
      }
    }
    if (changed) setVersion((v) => v + 1);
  });

  // Etkin öğeyi görünür alana getir (yalnız activeKey değişince).
  const pendingActive = useRef<string | undefined>(undefined);
  const activeKey = opts.activeKey ?? undefined;
  useLayoutEffect(() => {
    pendingActive.current = activeKey;
  }, [activeKey]);
  useLayoutEffect(() => {
    if (pendingActive.current === undefined) return;
    const target = keys.indexOf(pendingActive.current);
    if (target < 0) {
      pendingActive.current = undefined;
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const child = el.querySelector<HTMLElement>(`:scope > [data-vi="${target}"]`);
    if (child) {
      pendingActive.current = undefined;
      child.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!windowed) return;
    const scroller = scrollParent(el);
    const listTop = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = listTop + centeredOffset(offsets, target, scroller.clientHeight);
    syncView();
  });

  const total = offsets[offsets.length - 1] ?? 0;
  return {
    containerRef,
    start: range.start,
    end: range.end,
    padTop: windowed ? (offsets[range.start] ?? 0) : 0,
    padBottom: windowed ? Math.max(0, total - (offsets[range.end] ?? total)) : 0,
    windowed,
  };
}

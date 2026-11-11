import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { scrollParent } from '../../lib/scrollParent';
import { centeredOffset, prefixOffsets, windowRange } from '../../lib/windowing';

/** Bu sayının altındaki tablolar olduğu gibi çizilir (üye diff'i, küçük dosyalar). */
const WINDOW_THRESHOLD = 300;
/** Görünür alanın üstünde/altında hazır tutulan pay (piksel). */
const OVERSCAN_PX = 900;
const DEFAULT_ROW_PX = 20;

export interface WindowItem {
  key: string;
  kind: string;
}

export interface RowWindow {
  bodyRef: RefObject<HTMLTableSectionElement | null>;
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  windowed: boolean;
}

interface Focus {
  index: number;
  tick: number;
}

function flash(el: HTMLElement): void {
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
}

/**
 * Basit pencereleme: yalnız görünür satırlar (+ pay) çizilir, üst/alt boşluk aralayıcı satırlarla korunur.
 * Satır yükseklikleri çizildikçe ölçülür; ölçülmeyenler aynı türün ilk ölçümüyle tahmin edilir.
 * `focus` verilirse o öğe ortalanıp vurgulanır (çizili değilse önce tahmini konuma atlanır); bitince `onFocusDone` çağrılır.
 */
export function useRowWindow(items: readonly WindowItem[], focus: Focus | null, onFocusDone?: (tick: number) => void): RowWindow {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const heights = useRef(new Map<string, number>());
  const kindHeight = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });
  const handledTick = useRef<number | null>(null);
  const windowed = items.length > WINDOW_THRESHOLD;

  const offsets = useMemo(() => {
    void version; // ölçüm değişince yeniden hesapla
    return prefixOffsets(items.map((it) => heights.current.get(it.key) ?? kindHeight.current.get(it.kind) ?? DEFAULT_ROW_PX));
  }, [items, version]);

  const syncView = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const scroller = scrollParent(body);
    const sr = scroller.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const top = sr.top - br.top;
    const height = scroller.clientHeight;
    setView((v) => (Math.abs(v.top - top) < 1 && v.height === height ? v : { top, height }));
  }, []);

  // Kaydırma ve boyut değişimini izle.
  useLayoutEffect(() => {
    if (!windowed) return;
    const body = bodyRef.current;
    if (!body) return;
    const scroller = scrollParent(body);
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
    const ro = new ResizeObserver(schedule);
    ro.observe(scroller);
    return () => {
      target.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [windowed, syncView]);

  const range = windowed ? windowRange(offsets, view.top, view.top + view.height, OVERSCAN_PX) : { start: 0, end: items.length };

  // Çizilen satırları ölç.
  useLayoutEffect(() => {
    if (!windowed) return;
    const body = bodyRef.current;
    if (!body) return;
    let changed = false;
    for (const el of body.querySelectorAll<HTMLElement>('tr[data-vi]')) {
      const it = items[Number(el.dataset.vi)];
      if (!it) continue;
      const h = el.getBoundingClientRect().height;
      if (h <= 0) continue;
      if (!kindHeight.current.has(it.kind)) kindHeight.current.set(it.kind, h);
      if (Math.abs((heights.current.get(it.key) ?? -1) - h) > 0.5) {
        heights.current.set(it.key, h);
        changed = true;
      }
    }
    if (changed) setVersion((v) => v + 1);
  });

  // Odak satırına kaydır.
  useLayoutEffect(() => {
    if (!focus || focus.index < 0 || handledTick.current === focus.tick) return;
    const body = bodyRef.current;
    if (!body) return;
    const el = body.querySelector<HTMLElement>(`tr[data-vi="${focus.index}"]`);
    if (el) {
      handledTick.current = focus.tick;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      flash(el);
      onFocusDone?.(focus.tick);
      return;
    }
    const scroller = scrollParent(body);
    const bodyTop = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = bodyTop + centeredOffset(offsets, focus.index, scroller.clientHeight);
    syncView();
  }, [focus, offsets, range.start, range.end, syncView, onFocusDone]);

  const total = offsets[offsets.length - 1] ?? 0;
  return {
    bodyRef,
    start: range.start,
    end: range.end,
    padTop: windowed ? (offsets[range.start] ?? 0) : 0,
    padBottom: windowed ? Math.max(0, total - (offsets[range.end] ?? total)) : 0,
    windowed,
  };
}

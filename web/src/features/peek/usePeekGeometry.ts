import { useCallback, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { PanelSize } from '../../lib/peekLayout';
import { clampRect } from '../../lib/peekLayout';
import type { PeekRect } from '../../lib/peekStack';

type Mode = 'move' | 'resize';

/**
 * Pencereyi başlıktan sürükleme ve sağ-alt köşeden boyutlandırma (pointer events + yakalama).
 * Sürükleme sırasında konum yerel tutulur; bırakınca `commit` ile depoya yazılır. Panel sınırları ve asgari boyut korunur.
 */
export function usePeekGeometry(rect: PeekRect, panel: PanelSize, commit: (r: PeekRect) => void, disabled: boolean) {
  const [live, setLive] = useState<PeekRect | null>(null);
  const drag = useRef<{ mode: Mode; x: number; y: number; base: PeekRect; last: PeekRect } | null>(null);

  const start = useCallback(
    (mode: Mode) => (e: PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return;
      // Başlıktaki düğmeler ve bağlantılar sürüklemeyi başlatmaz.
      if (mode === 'move' && (e.target as HTMLElement).closest('button, a, input, [role="link"], [data-nodrag]')) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { mode, x: e.clientX, y: e.clientY, base: rect, last: rect };
    },
    [disabled, rect],
  );

  const move = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const next = d.mode === 'move' ? { ...d.base, x: d.base.x + dx, y: d.base.y + dy } : { ...d.base, w: d.base.w + dx, h: d.base.h + dy };
      const r = clampRect(next, panel);
      // Boyutlandırmada sol-üst köşe sabit kalır: sığmayan genişlik/yükseklik kırpılır.
      const fixed = d.mode === 'resize' ? { x: d.base.x, y: d.base.y, w: Math.min(r.w, panel.w - d.base.x), h: Math.min(r.h, panel.h - d.base.y) } : r;
      d.last = fixed;
      setLive(fixed);
    },
    [panel],
  );

  const end = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      setLive(null);
      if (d.last !== d.base) commit(d.last);
    },
    [commit],
  );

  const handlers = (mode: Mode) => ({ onPointerDown: start(mode), onPointerMove: move, onPointerUp: end, onPointerCancel: end });
  return { rect: live ?? rect, dragging: live !== null, moveHandlers: handlers('move'), resizeHandlers: handlers('resize') };
}

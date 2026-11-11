import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { SidePanel } from '../lib/panelSizes';
import { clampPanelWidth, dragOutcome, keyboardWidth, PANEL_LIMITS } from '../lib/panelSizes';
import { useLayout } from '../state/layoutStore';

interface SplitterProps {
  panel: SidePanel;
  /** Panelin şu an çizilen genişliği. */
  width: number;
  /** Diğer yan panelin çizilen genişliği (orta panel payı için). */
  otherWidth: number;
  collapsed: boolean;
}

const LABEL: Record<SidePanel, string> = { nav: 'Gezgin genişliği', insp: 'Denetçi genişliği' };

/**
 * Paneller arası sürüklenebilir ayraç (pointer events). Klavye: odaklanıp ←/→ (Shift: büyük adım), Home/End,
 * Enter daralt/aç. Çift tık varsayılan genişliğe döner. En küçüğün belirgin altına sürüklemek paneli daraltır.
 */
export function Splitter({ panel, width, otherWidth, collapsed }: SplitterProps) {
  const setWidth = useLayout((s) => s.setWidth);
  const setCollapsed = useLayout((s) => s.setCollapsed);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const { min, max, def } = PANEL_LIMITS[panel];

  const end = () => {
    drag.current = null;
    setDragging(false);
    document.body.classList.remove('is-resizing-x');
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Daraltılmış panelden sürüklemeye başlanırsa en küçük genişlikten açılır.
    drag.current = { x: e.clientX, w: collapsed ? min - 1 : width };
    setDragging(true);
    document.body.classList.add('is-resizing-x');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const raw = panel === 'nav' ? d.w + dx : d.w - dx;
    const out = dragOutcome(panel, raw, window.innerWidth, otherWidth);
    const isCollapsed = useLayout.getState()[panel === 'nav' ? 'navCollapsed' : 'inspCollapsed'];
    if (out.collapse) {
      if (!isCollapsed) setCollapsed(panel, true);
      return;
    }
    if (isCollapsed) setCollapsed(panel, false);
    setWidth(panel, out.width);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setCollapsed(panel, !collapsed);
      return;
    }
    const next = keyboardWidth(panel, e.key, e.shiftKey, collapsed ? min : width);
    if (next === null) return;
    e.preventDefault();
    if (collapsed) setCollapsed(panel, false);
    setWidth(panel, clampPanelWidth(panel, next, window.innerWidth, otherWidth));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={LABEL[panel]}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={collapsed ? 0 : Math.round(width)}
      aria-valuetext={collapsed ? 'daraltıldı' : `${Math.round(width)} piksel`}
      tabIndex={0}
      className={`splitter splitter--${panel}${dragging ? ' is-dragging' : ''}`}
      title="Sürükleyin: genişlik · çift tık: varsayılan · odaklanıp ←/→, Enter: daralt/aç"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => {
        setCollapsed(panel, false);
        setWidth(panel, def);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

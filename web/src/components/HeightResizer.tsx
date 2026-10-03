import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { clampHeight, SECTION_MAX_H, SECTION_MIN_H } from '../lib/panelSizes';
import { useLayout } from '../state/layoutStore';

interface HeightResizerProps {
  /** Kalıcılık anahtarı (layoutStore.heights). */
  id: string;
  /** Yüksekliği değişen öğe (sürükleme başlangıcında ölçülür). */
  target: RefObject<HTMLElement | null>;
  label: string;
}

const STEP = 24;
const STEP_BIG = 96;

/**
 * Bölümün altındaki yatay tutamak: sürükleyerek (ya da odaklanıp ↑/↓) yüksekliği değiştirir; çift tık otomatik yüksekliğe döner.
 */
export function HeightResizer({ id, target, label }: HeightResizerProps) {
  const height = useLayout((s) => s.heights[id]);
  const setHeight = useLayout((s) => s.setHeight);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const measured = () => target.current?.getBoundingClientRect().height ?? height ?? SECTION_MIN_H;

  const end = () => {
    drag.current = null;
    setDragging(false);
    document.body.classList.remove('is-resizing-y');
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: measured() };
    setDragging(true);
    document.body.classList.add('is-resizing-y');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setHeight(id, clampHeight(d.h + e.clientY - d.y));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP_BIG : STEP;
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = measured() + step;
    else if (e.key === 'ArrowUp') next = measured() - step;
    else if (e.key === 'Home') next = SECTION_MIN_H;
    else if (e.key === 'Escape' || e.key === 'Delete') {
      e.preventDefault();
      setHeight(id, null);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    setHeight(id, clampHeight(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={SECTION_MIN_H}
      aria-valuemax={SECTION_MAX_H}
      aria-valuenow={height !== undefined ? Math.round(height) : undefined}
      aria-valuetext={height !== undefined ? `${Math.round(height)} piksel` : 'otomatik yükseklik'}
      tabIndex={0}
      className={`hresizer${dragging ? ' is-dragging' : ''}${height !== undefined ? ' is-sized' : ''}`}
      title="Sürükleyin: yükseklik · çift tık: otomatik · odaklanıp ↑/↓"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => setHeight(id, null)}
      onKeyDown={onKeyDown}
    >
      <span className="hresizer__grip" aria-hidden="true" />
    </div>
  );
}

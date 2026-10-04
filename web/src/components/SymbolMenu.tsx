import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { ImpactNodeStatus } from '../../../src/shared/types';
import { menuKeyNav, usePopoverDismiss } from '../hooks/usePopoverDismiss';
import type { OpenIntent } from '../lib/openIntent';
import { intentOf } from '../lib/openIntent';
import { StatusGlyph } from './StatusGlyph';

export interface SymbolMenuItem {
  key: string;
  label: string;
  /** İmza ya da konum (eşaralıklı küçük metin). */
  detail?: string;
  status?: ImpactNodeStatus;
  /** Sağda kısa not ('diff dışı', 'olası'…). */
  note?: string;
}

interface SymbolMenuProps<T extends SymbolMenuItem> {
  title: string;
  items: T[];
  /** Ekrana göre konum (tıklama noktası ya da tetikleyicinin alt kenarı). */
  at: { x: number; y: number };
  /** `intent`: düz tık gözat, Shift sekme, Ctrl/orta tık arka plan sekmesi (`background` geriye uyumluluk için). */
  onPick: (item: T, background: boolean, intent: OpenIntent) => void;
  onClose: () => void;
}

/**
 * Sembol seçim menüsü (aşırı yüklemeler, çağıranlar, alt tipler…). Ok tuşlarıyla gezilir, Esc/dışarı tık kapatır.
 * Tık: gözatma penceresi; Shift+tık: sekmede aç; Ctrl/Cmd+tık ya da orta tık: arka plan sekmesi.
 */
export function SymbolMenu<T extends SymbolMenuItem>({ title, items, at, onPick, onClose }: SymbolMenuProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  usePopoverDismiss(ref, onClose);

  // Ekrandan taşmasın.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8));
    const y = at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height - 24) : at.y;
    setPos({ x, y });
  }, [at]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') onClose();
    else if (menuKeyNav(ref.current, e.key)) e.preventDefault();
  };

  const pick = (item: T, e: MouseEvent) => {
    e.preventDefault();
    const intent = intentOf(e);
    onPick(item, intent === 'background', intent);
    onClose();
  };

  return (
    <div ref={ref} className="smenu" role="menu" aria-label={title} style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown}>
      <p className="smenu__title">{title}</p>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="smenu__item"
          onClick={(e) => pick(item, e)}
          onAuxClick={(e) => e.button === 1 && pick(item, e)}
          onMouseDown={(e) => (e.button === 1 || e.shiftKey) && e.preventDefault()}
        >
          {item.status ? <StatusGlyph status={item.status} size="sm" /> : <span className="smenu__dot" aria-hidden="true" />}
          <span className="smenu__main">
            <span className="smenu__label">{item.label}</span>
            {item.detail && <span className="smenu__detail">{item.detail}</span>}
          </span>
          {item.note && <span className="smenu__note">{item.note}</span>}
        </button>
      ))}
      <p className="smenu__hint">Tık: gözat · Shift: sekmede aç · Ctrl: arka plan sekmesi</p>
    </div>
  );
}

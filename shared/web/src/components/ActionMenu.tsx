import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { menuKeyNav, usePopoverDismiss } from '../hooks/usePopoverDismiss';

export interface MenuAction {
  key: string;
  label: ReactNode;
  /** Sağda kısa ek (kısayol, yol). */
  hint?: string;
  current?: boolean;
  disabled?: boolean;
  /** Önceki öğeden ayırıcıyla ayrılır. */
  separated?: boolean;
  onSelect: () => void;
}

interface ActionMenuProps {
  label: string;
  actions: MenuAction[];
  at: { x: number; y: number };
  onClose: () => void;
}

/** Komut menüsü (sekme bağlam menüsü, açık sekmeler listesi). */
export function ActionMenu({ label, actions, at, onClose }: ActionMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  usePopoverDismiss(ref, onClose);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)) });
  }, [at]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') onClose();
    else if (menuKeyNav(ref.current, e.key)) e.preventDefault();
  };

  return (
    <div ref={ref} className="smenu amenu" role="menu" aria-label={label} style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown}>
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          role="menuitem"
          className={`smenu__item amenu__item${a.current ? ' is-current' : ''}${a.separated ? ' is-separated' : ''}`}
          disabled={a.disabled}
          aria-current={a.current ? 'true' : undefined}
          onClick={() => {
            a.onSelect();
            onClose();
          }}
        >
          <span className="smenu__main">
            <span className="smenu__label">{a.label}</span>
          </span>
          {a.hint && <span className="smenu__note">{a.hint}</span>}
        </button>
      ))}
    </div>
  );
}

import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
}

/** Erişilebilir modal: odak içeri alınır, Esc kapatır, kapanınca odak geri döner. */
export function Modal({ title, onClose, children, actions, wide = false }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panelRef.current?.querySelector<HTMLElement>('button, [href], input, textarea, select');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal__head">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Kapat">
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {actions && <footer className="modal__actions">{actions}</footer>}
      </div>
    </div>
  );
}

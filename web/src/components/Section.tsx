import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLayout } from '../state/layoutStore';
import { HeightResizer } from './HeightResizer';

interface SectionProps {
  /** Kalıcılık anahtarı ('insp.risk' gibi); açık/kapalı durumu ve yüksekliği bununla saklanır. */
  id: string;
  title: ReactNode;
  /** Başlığın sağında, açma düğmesinin dışında gösterilen ek (rozet, sayaç). */
  extra?: ReactNode;
  defaultOpen?: boolean;
  /** Uzun içerik: yükseklik sürüklenebilir (gövde kendi içinde kaydırılır). */
  resizable?: boolean;
  className?: string;
  /** Yükseklik tutamağının erişilebilir adı. */
  resizeLabel?: string;
  children: ReactNode;
}

/** Açılır/kapanır denetçi bölümü (akordiyon); durumu tarayıcıda saklanır. */
export function Section({ id, title, extra, defaultOpen = true, resizable = false, className, resizeLabel, children }: SectionProps) {
  const open = useLayout((s) => (s.closed[id] === undefined ? defaultOpen : !s.closed[id]));
  const height = useLayout((s) => (resizable ? s.heights[id] : undefined));
  const setOpen = useLayout((s) => s.setOpen);
  const bodyId = useId();
  const headId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <section className={`insp__sec acc${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={headId}>
      <h3 className="insp__h acc__h">
        <button type="button" id={headId} className="acc__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(id, !open)}>
          <span className="acc__caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          {title}
        </button>
        {extra}
      </h3>
      <div
        id={bodyId}
        ref={bodyRef}
        className={`acc__body${height !== undefined ? ' is-sized' : ''}`}
        hidden={!open}
        style={height !== undefined ? { height } : undefined}
      >
        {open && children}
      </div>
      {open && resizable && <HeightResizer id={id} target={bodyRef} label={resizeLabel ?? 'Bölüm yüksekliği'} />}
    </section>
  );
}

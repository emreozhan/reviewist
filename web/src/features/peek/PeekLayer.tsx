import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { peekRectFor } from '../../lib/peekLayout';
import type { PanelSize } from '../../lib/peekLayout';
import { takeRootReturnFocus, usePeek } from '../../state/peekStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { PeekConnectors } from './PeekConnectors';
import { PeekWindow } from './PeekWindow';
import { usePeekAutoClose, usePeekKeys } from './usePeekKeys';

/**
 * Gözatma yığını katmanı: orta panelin içinde, etkin sekmenin önünde. Katman tıklamaları geçirir (arkadaki panel
 * kullanılabilir kalır); yalnız pencereler etkileşimlidir. Odak: açılınca pencere gövdesine, kapanınca bir alttakine,
 * hepsi kapanınca tıklanan bağlantıya döner.
 */
export function PeekLayer() {
  const { review } = useReviewCtx();
  const entries = usePeek((s) => s.entries);
  const notice = usePeek((s) => s.notice);
  const noticeSeq = usePeek((s) => s.noticeSeq);
  const layerRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<PanelSize & { left: number; top: number }>({ w: 0, h: 0, left: 0, top: 0 });
  const bodies = useRef(new Map<string, HTMLDivElement>());
  const prevEntries = useRef(entries);

  useEffect(() => usePeek.getState().reset(review.id), [review.id]);
  usePeekAutoClose();
  usePeekKeys(bodies);

  // Panel boyutu (basamaklı yerleşim ve bağlantı çizgileri için).
  useLayoutEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setPanel((p) => (p.w === r.width && p.h === r.height && p.left === r.left && p.top === r.top ? p : { w: r.width, h: r.height, left: r.left, top: r.top }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Odak yönetimi.
  useEffect(() => {
    const prev = prevEntries.current;
    prevEntries.current = entries;
    const top = entries[entries.length - 1];
    const prevTop = prev[prev.length - 1];
    if (!top) {
      if (prev.length > 0) {
        const back = takeRootReturnFocus(prev[0]?.uid);
        if (back?.isConnected) back.focus({ preventScroll: true });
      }
      return;
    }
    if (top.uid === prevTop?.uid) return;
    const focusTop = () => {
      const body = bodies.current.get(top.uid);
      const win = body?.closest('.peek');
      if (body && !(win && win.contains(document.activeElement))) body.focus({ preventScroll: true });
    };
    focusTop();
    // Kapanan menüler odağı kendi tetikleyicisine geri verebilir: bir kare sonra yeniden.
    const raf = requestAnimationFrame(focusTop);
    return () => cancelAnimationFrame(raf);
  }, [entries]);

  // Bilgi notu birkaç saniye sonra kaybolur.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => usePeek.getState().clearNotice(), 4500);
    return () => clearTimeout(t);
  }, [notice, noticeSeq]);

  const bodyRef = useCallback(
    (uid: string) => (el: HTMLDivElement | null) => {
      if (el) bodies.current.set(uid, el);
      else bodies.current.delete(uid);
    },
    [],
  );

  const ready = panel.w > 0 && panel.h > 0;
  const rects = ready ? entries.map((e, i) => peekRectFor(i, panel, e)) : [];

  return (
    <div ref={layerRef} className={`peek-layer${entries.length > 0 ? ' has-peeks' : ''}`}>
      {ready && entries.length > 0 && <PeekConnectors entries={entries} rects={rects} panel={panel} />}
      {ready &&
        entries.map((e, i) => (
          <PeekWindow
            key={e.uid}
            entry={e}
            level={i}
            depth={entries.length}
            rect={rects[i] ?? { x: 0, y: 0, w: panel.w, h: panel.h }}
            panel={panel}
            crumbs={entries}
            bodyRef={bodyRef(e.uid)}
          />
        ))}
      {notice && (
        <p key={noticeSeq} className="peek-layer__notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

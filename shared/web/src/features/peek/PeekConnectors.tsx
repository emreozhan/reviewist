import type { PanelSize } from '../../lib/peekLayout';
import type { PeekEntry, PeekRect } from '../../lib/peekStack';

interface PeekConnectorsProps {
  entries: PeekEntry[];
  rects: PeekRect[];
  panel: PanelSize & { left: number; top: number };
}

const HEAD_Y = 20;

/** Pencere katman sırası: seviyeler arasında bağlantı çizgisine yer bırakılır. */
export const peekZ = (level: number): number => 10 + level * 2;

/**
 * Tıklanan bağlantıdan pencereye uzanan ince eğri (kullanıcının çizimindeki bağlantı çizgileri).
 * Tık noktası panelin dışındaysa (denetçi, gezgin) en yakın kenara sabitlenir. Yalnız görsel ipucu: etkileşimsiz.
 */
export function PeekConnectors({ entries, rects, panel }: PeekConnectorsProps) {
  const paths = entries.flatMap((e, i) => {
    const r = rects[i];
    if (!e.origin || !r || e.maximized) return [];
    const sx = Math.max(2, Math.min(panel.w - 2, e.origin.x - panel.left));
    const sy = Math.max(2, Math.min(panel.h - 2, e.origin.y - panel.top));
    // Başlangıç pencerenin sağındaysa sağ kenara, değilse sol kenara bağlanır.
    const right = sx > r.x + r.w;
    const ex = right ? r.x + r.w : r.x;
    const ey = r.y + HEAD_Y;
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return [];
    const mx = (sx + ex) / 2;
    const d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`;
    return [{ key: e.uid, d, sx, sy, ex, ey, level: i, top: i === entries.length - 1 }];
  });
  if (paths.length === 0) return null;
  // Her çizgi kendi katmanında: kaynağın bulunduğu pencerenin (bir alt seviye) üstünde, hedef pencerenin altında.
  return (
    <>
      {paths.map((p) => (
        <svg key={p.key} className={`peek-links peek--l${p.level % 4}${p.top ? ' is-top' : ''}`} width={panel.w} height={panel.h} style={{ zIndex: peekZ(p.level) - 1 }} aria-hidden="true">
          <path d={p.d} />
          <circle cx={p.sx} cy={p.sy} r={3.5} />
          <circle cx={p.ex} cy={p.ey} r={2.5} className="peek-links__end" />
        </svg>
      ))}
    </>
  );
}

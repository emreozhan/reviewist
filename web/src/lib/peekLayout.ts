/**
 * Gözatma pencerelerinin basamaklı (cascade) yerleşimi: orta panelin içinde, her seviye bir öncekine göre
 * sağa ve aşağı kayar. İlk pencere panelin ~%15 solundan/yukarısından başlar, sağ ve alt boşluk azdır.
 * Derinleştikçe pencere küçülür; asgari boyuta inince ofset sabitlenir. Dar panelde (< 900 px) pencereler
 * paneli kaplar, ofset küçülür.
 */
import type { PeekRect } from './peekStack';

export interface PanelSize {
  w: number;
  h: number;
}

export const PEEK_COMPACT_BELOW = 900;
export const PEEK_STEP = { x: 40, y: 44 } as const;
export const PEEK_COMPACT_STEP = { x: 14, y: 16 } as const;
export const PEEK_GAP = { right: 14, bottom: 12 } as const;
export const PEEK_MIN = { w: 360, h: 220 } as const;
/** Basamaklı yerleşimde pencerenin inebileceği en küçük boyut (bundan sonra ofset sabitlenir). */
const CASCADE_MIN = { w: 520, h: 300 } as const;
const COMPACT_MAX_LEVEL = 4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function isCompact(panel: PanelSize): boolean {
  return panel.w < PEEK_COMPACT_BELOW;
}

/** `level` (0 tabanlı) seviyedeki pencerenin varsayılan konumu ve boyutu (panel koordinatı). */
export function cascadeRect(level: number, panel: PanelSize): PeekRect {
  const W = Math.max(0, Math.round(panel.w));
  const H = Math.max(0, Math.round(panel.h));
  if (isCompact(panel)) {
    const maxX = Math.floor(Math.max(0, W - PEEK_MIN.w) / PEEK_COMPACT_STEP.x);
    const maxY = Math.floor(Math.max(0, H - PEEK_MIN.h) / PEEK_COMPACT_STEP.y);
    const l = Math.max(0, Math.min(level, COMPACT_MAX_LEVEL, maxX, maxY));
    const x = l * PEEK_COMPACT_STEP.x;
    const y = l * PEEK_COMPACT_STEP.y;
    return { x, y, w: Math.max(0, W - x), h: Math.max(0, H - y) };
  }
  const minW = Math.min(CASCADE_MIN.w, W);
  const minH = Math.min(CASCADE_MIN.h, H);
  const x0 = Math.round(clamp(W * 0.15, 0, Math.min(280, Math.max(0, W - PEEK_GAP.right - minW))));
  const y0 = Math.round(clamp(H * 0.15, 0, Math.min(170, Math.max(0, H - PEEK_GAP.bottom - minH))));
  const maxL = Math.max(
    0,
    Math.min(
      Math.floor((W - PEEK_GAP.right - minW - x0) / PEEK_STEP.x),
      Math.floor((H - PEEK_GAP.bottom - minH - y0) / PEEK_STEP.y),
    ),
  );
  const l = Math.max(0, Math.min(level, maxL));
  const x = x0 + l * PEEK_STEP.x;
  const y = y0 + l * PEEK_STEP.y;
  return { x, y, w: Math.max(0, W - PEEK_GAP.right - x), h: Math.max(0, H - PEEK_GAP.bottom - y) };
}

/**
 * Kullanıcının sürüklediği/boyutlandırdığı pencereyi panel sınırlarına sığdırır: boyut [asgari, panel],
 * konum pencere tamamen panelin içinde kalacak şekilde.
 */
export function clampRect(rect: PeekRect, panel: PanelSize): PeekRect {
  const W = Math.max(0, panel.w);
  const H = Math.max(0, panel.h);
  const w = clamp(rect.w, Math.min(PEEK_MIN.w, W), W);
  const h = clamp(rect.h, Math.min(PEEK_MIN.h, H), H);
  return { x: clamp(rect.x, 0, W - w), y: clamp(rect.y, 0, H - h), w, h };
}

/** Pencerenin gösterilecek konumu: büyütülmüşse paneli kaplar, sürüklenmişse sınırlanmış konum, yoksa basamak. */
export function peekRectFor(level: number, panel: PanelSize, entry: { rect?: PeekRect; maximized: boolean }): PeekRect {
  if (entry.maximized) return { x: 0, y: 0, w: Math.max(0, panel.w), h: Math.max(0, panel.h) };
  if (entry.rect) return clampRect(entry.rect, panel);
  return cascadeRect(level, panel);
}

import { modLabel } from './platform';

/**
 * Bağlantı tıklama niyeti (koddaki referanslar, yayılım satırları, rozet menüleri, etki haritası düğümleri):
 *   düz tık / Enter          → 'peek'        orta panelin önünde gözatma penceresi (iç içe yığın)
 *   Ctrl/Cmd+tık, orta tık   → 'background'  arka planda sekme (mevcut davranış)
 *   Shift+tık / Shift+Enter  → 'tab'         doğrudan sekmede aç (öne gelir)
 */
export type OpenIntent = 'peek' | 'background' | 'tab';

export interface IntentEventLike {
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function intentOf(e: IntentEventLike): OpenIntent {
  if (e.button === 1 || e.ctrlKey || e.metaKey) return 'background';
  if (e.shiftKey) return 'tab';
  return 'peek';
}

/** Arka plan sekmesi değiştiricisiyle tık etiketi: macOS'ta `⌘+tık`, diğerlerinde `Ctrl+tık`. */
export function bgClickLabel(mod: string = modLabel): string {
  return `${mod}+tık`;
}

/** Bağlantı ipuçlarının ortak kuyruğu (platforma göre ⌘ / Ctrl). */
export function intentHint(mod: string = modLabel): string {
  return `Tık: pencerede aç · Shift+tık: sekmede aç · ${bgClickLabel(mod)}: arka plan sekmesi`;
}

export const INTENT_HINT: string = intentHint();

/** Arka plan sekmesi tık etiketi (ör. `⌘+tık` / `Ctrl+tık`). */
export const BG_CLICK: string = bgClickLabel();

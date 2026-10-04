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

/** Bağlantı ipuçlarının ortak kuyruğu. */
export const INTENT_HINT = 'Tık: gözat (açılır pencere) · Shift+tık: sekmede aç · Ctrl+tık: arka plan sekmesi';

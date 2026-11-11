/** Yan panel genişlik sınırları ve ayraç (splitter) hesapları; saf fonksiyonlar (birim testli). */
export type SidePanel = 'nav' | 'insp';

export interface PanelLimits {
  min: number;
  max: number;
  /** Varsayılan genişlik (çift tıklamayla dönülen). */
  def: number;
}

export const PANEL_LIMITS: Record<SidePanel, PanelLimits> = {
  nav: { min: 220, max: 640, def: 320 },
  insp: { min: 280, max: 820, def: 380 },
};

/** Orta panelin altına düşmeyeceği genişlik. */
export const CENTER_MIN = 360;
/** Daraltılmış panelin şerit genişliği. */
export const RAIL_W = 38;
/** Sürüklerken en küçük genişliğin bu kadar altına inilirse panel daralır. */
export const COLLAPSE_SLACK = 70;
/** Klavye adımları (piksel): ok tuşu / Shift+ok. */
export const KEY_STEP = 16;
export const KEY_STEP_BIG = 64;

/**
 * Genişliği sınırlar: önce panelin kendi min/max'ı, sonra orta panele en az CENTER_MIN kalacak şekilde
 * pencere genişliğinden düşülen üst sınır (diğer yan panelin o anki genişliğiyle).
 */
export function clampPanelWidth(panel: SidePanel, width: number, viewport: number, otherWidth: number): number {
  const { min, max } = PANEL_LIMITS[panel];
  const room = viewport - otherWidth - CENTER_MIN;
  const upper = Math.max(min, Math.min(max, room));
  return Math.round(Math.min(upper, Math.max(min, width)));
}

/** Sürükleme sonucu: istenen ham genişlik en küçüğün belirgin altındaysa panel daraltılır. */
export function dragOutcome(panel: SidePanel, rawWidth: number, viewport: number, otherWidth: number): { collapse: true } | { collapse: false; width: number } {
  if (rawWidth < PANEL_LIMITS[panel].min - COLLAPSE_SLACK) return { collapse: true };
  return { collapse: false, width: clampPanelWidth(panel, rawWidth, viewport, otherWidth) };
}

/**
 * Ayraç üzerinde klavye: ←/→ genişliği değiştirir (Shift ile büyük adım), Home/End en küçük/en büyük.
 * Gezgin ayracında → genişletir; denetçi ayracında (sağ panel) ← genişletir.
 * Tanınmayan tuşta null.
 */
export function keyboardWidth(panel: SidePanel, key: string, shift: boolean, width: number): number | null {
  const step = shift ? KEY_STEP_BIG : KEY_STEP;
  const grow = panel === 'nav' ? 'ArrowRight' : 'ArrowLeft';
  const shrink = panel === 'nav' ? 'ArrowLeft' : 'ArrowRight';
  if (key === grow) return width + step;
  if (key === shrink) return width - step;
  if (key === 'Home') return PANEL_LIMITS[panel].min;
  if (key === 'End') return PANEL_LIMITS[panel].max;
  return null;
}

/** Bölüm (akordiyon) yüksekliği sınırları. */
export const SECTION_MIN_H = 80;
export const SECTION_MAX_H = 1600;

export function clampHeight(h: number, min = SECTION_MIN_H, max = SECTION_MAX_H): number {
  return Math.round(Math.min(max, Math.max(min, h)));
}

/** Kayıtlı sayının geçerliliği (localStorage'dan gelen bozuk değerler varsayılana düşer). */
export function validWidth(panel: SidePanel, v: unknown): number {
  const { min, max, def } = PANEL_LIMITS[panel];
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : def;
}

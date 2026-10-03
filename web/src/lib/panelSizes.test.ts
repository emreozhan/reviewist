import { describe, expect, it } from 'vitest';
import { CENTER_MIN, clampHeight, clampPanelWidth, COLLAPSE_SLACK, dragOutcome, keyboardWidth, KEY_STEP, KEY_STEP_BIG, PANEL_LIMITS, SECTION_MAX_H, SECTION_MIN_H, validWidth } from './panelSizes';

describe('ayraç boyut sınırları', () => {
  it('panelin kendi min/max sınırları uygulanır', () => {
    expect(clampPanelWidth('nav', 10, 3000, 380)).toBe(PANEL_LIMITS.nav.min);
    expect(clampPanelWidth('nav', 5000, 3000, 380)).toBe(PANEL_LIMITS.nav.max);
    expect(clampPanelWidth('insp', 500.4, 3000, 320)).toBe(500);
  });

  it('orta panele en az CENTER_MIN kalır', () => {
    const viewport = 1200;
    const other = 380;
    const w = clampPanelWidth('nav', 900, viewport, other);
    expect(w).toBe(viewport - other - CENTER_MIN);
    expect(viewport - other - w).toBeGreaterThanOrEqual(CENTER_MIN);
  });

  it('pencere çok darsa yine de panel en küçüğünün altına inmez', () => {
    expect(clampPanelWidth('insp', 400, 700, 320)).toBe(PANEL_LIMITS.insp.min);
  });

  it('en küçüğün belirgin altına sürüklemek paneli daraltır', () => {
    expect(dragOutcome('nav', PANEL_LIMITS.nav.min - COLLAPSE_SLACK - 1, 2000, 380)).toEqual({ collapse: true });
    expect(dragOutcome('nav', PANEL_LIMITS.nav.min - 10, 2000, 380)).toEqual({ collapse: false, width: PANEL_LIMITS.nav.min });
  });

  it('klavye: gezginde → genişletir, denetçide ← genişletir; Shift büyük adım; Home/End', () => {
    expect(keyboardWidth('nav', 'ArrowRight', false, 300)).toBe(300 + KEY_STEP);
    expect(keyboardWidth('nav', 'ArrowLeft', true, 300)).toBe(300 - KEY_STEP_BIG);
    expect(keyboardWidth('insp', 'ArrowLeft', false, 400)).toBe(400 + KEY_STEP);
    expect(keyboardWidth('insp', 'ArrowRight', false, 400)).toBe(400 - KEY_STEP);
    expect(keyboardWidth('insp', 'Home', false, 400)).toBe(PANEL_LIMITS.insp.min);
    expect(keyboardWidth('nav', 'End', false, 400)).toBe(PANEL_LIMITS.nav.max);
    expect(keyboardWidth('nav', 'Enter', false, 400)).toBeNull();
  });

  it('bölüm yüksekliği ve kayıtlı genişlik doğrulaması', () => {
    expect(clampHeight(5)).toBe(SECTION_MIN_H);
    expect(clampHeight(99999)).toBe(SECTION_MAX_H);
    expect(validWidth('nav', 'x')).toBe(PANEL_LIMITS.nav.def);
    expect(validWidth('nav', 9999)).toBe(PANEL_LIMITS.nav.def);
    expect(validWidth('nav', 401.6)).toBe(402);
  });
});

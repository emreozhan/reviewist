import { describe, expect, it } from 'vitest';
import { intentOf } from './openIntent';

describe('tık niyeti', () => {
  it('düz tık gözatma penceresi açar', () => {
    expect(intentOf({ button: 0 })).toBe('peek');
    expect(intentOf({})).toBe('peek');
  });

  it('Ctrl/Cmd+tık ve orta tık arka plan sekmesi', () => {
    expect(intentOf({ button: 0, ctrlKey: true })).toBe('background');
    expect(intentOf({ button: 0, metaKey: true })).toBe('background');
    expect(intentOf({ button: 1 })).toBe('background');
    // Ctrl, Shift'e baskın (Ctrl+Shift: yine arka plan).
    expect(intentOf({ button: 0, ctrlKey: true, shiftKey: true })).toBe('background');
  });

  it('Shift+tık doğrudan sekmede açar', () => {
    expect(intentOf({ button: 0, shiftKey: true })).toBe('tab');
  });
});

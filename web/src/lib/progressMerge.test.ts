import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../../src/shared/types';
import { fileFingerprint, hash32 } from './fingerprint';
import type { KeyValueStorage, PersistedReviewState } from './persistence';
import { applyPatch, effectiveSeen, loadState, saveState, updateState } from './persistence';

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const EMPTY: PersistedReviewState = { seen: {}, notes: {} };

describe('ilerleme kaydı: oku-birleştir-yaz (iki tarayıcı sekmesi)', () => {
  it('iki sekmenin farklı notları birbirini ezmez', () => {
    const s = memory();
    // Sekme A ve B aynı boş durumla açıldı (bellekleri eski).
    const a = updateState('k', { notes: { 'file:A.java': 'A notu' } }, EMPTY, s);
    const b = updateState('k', { notes: { 'file:B.java': 'B notu' } }, EMPTY, s);
    expect(a.ok && b.ok).toBe(true);
    expect(loadState('k', s).notes).toEqual({ 'file:A.java': 'A notu', 'file:B.java': 'B notu' });
    expect(b.state.notes).toEqual({ 'file:A.java': 'A notu', 'file:B.java': 'B notu' });
  });

  it('aynı alanda son yazan kazanır; boş not alanı siler', () => {
    const s = memory();
    updateState('k', { notes: { n: 'ilk' } }, EMPTY, s);
    updateState('k', { notes: { n: 'son' } }, EMPTY, s);
    expect(loadState('k', s).notes).toEqual({ n: 'son' });
    updateState('k', { notes: { n: '  ' } }, EMPTY, s);
    expect(loadState('k', s).notes).toEqual({});
  });

  it('görüldü işaretleri de alan bazında birleşir', () => {
    const s = memory();
    updateState('k', { seen: { a: { value: true, print: 'p1' } } }, EMPTY, s);
    updateState('k', { seen: { b: { value: true } } }, EMPTY, s);
    updateState('k', { seen: { a: { value: false } } }, EMPTY, s);
    expect(loadState('k', s)).toEqual({ seen: { b: true }, notes: {} });
  });

  it('depolama yoksa bellek durumu üzerine uygulanır ve ok=false', () => {
    const r = updateState('k', { notes: { n: 'x' } }, { seen: { a: true }, notes: {} }, null);
    expect(r).toEqual({ state: { seen: { a: true }, notes: { n: 'x' } }, ok: false });
  });

  it('applyPatch yamada olmayan alanlara dokunmaz', () => {
    const base: PersistedReviewState = { seen: { a: true }, notes: { x: '1' }, seenPrints: { a: 'p' } };
    expect(applyPatch(base, { notes: { y: '2' } })).toEqual({ seen: { a: true }, notes: { x: '1', y: '2' }, seenPrints: { a: 'p' } });
  });
});

describe('görüldü parmak izi', () => {
  const file = (lines: { type: 'add' | 'del' | 'context'; text: string }[], extra: Partial<FileChange> = {}) =>
    ({
      status: 'modified',
      additions: lines.filter((l) => l.type === 'add').length,
      deletions: lines.filter((l) => l.type === 'del').length,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '', lines }],
      ...extra,
    }) as Pick<FileChange, 'status' | 'additions' | 'deletions' | 'hunks' | 'oldPath'>;

  it('hash32 kararlı ve 32 bit', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(hash32('abc')).not.toBe(hash32('abd'));
    expect(hash32('x')).toBeLessThan(2 ** 32);
  });

  it('aynı değişiklik aynı iz; satır kayması ve bağlam izi bozmaz', () => {
    const a = file([{ type: 'context', text: 'x' }, { type: 'add', text: 'return 1;' }]);
    const b = file([{ type: 'context', text: 'başka bağlam' }, { type: 'add', text: 'return 1;' }]);
    b.hunks[0] = { ...b.hunks[0]!, oldStart: 40, newStart: 42 };
    expect(fileFingerprint(a)).toBe(fileFingerprint(b));
  });

  it('eklenen satır metni değişince iz değişir (sayılar aynı olsa da)', () => {
    const a = file([{ type: 'add', text: 'return 1;' }]);
    const b = file([{ type: 'add', text: 'return 2;' }]);
    expect(fileFingerprint(a)).not.toBe(fileFingerprint(b));
    expect(fileFingerprint(a)).toMatch(/^1\/0\/[0-9a-f]{8}$/);
  });

  it('iz uyuşmazsa görülmedi + "görüldükten sonra değişti"; izsiz eski kayıt görüldü kalır', () => {
    const state: PersistedReviewState = { seen: { a: true, b: true, c: true, d: true }, notes: {}, seenPrints: { a: 'p1', b: 'eski', d: 'p4' } };
    const r = effectiveSeen(state, { a: 'p1', b: 'yeni', c: 'p3' });
    expect(r.seen).toEqual({ a: true, c: true, d: true });
    expect(r.stale).toEqual({ b: true });
  });

  it('parmak izi kaydedilir, okunur; işaret kalkınca izi de silinir', () => {
    const s = memory();
    updateState('k', { seen: { a: { value: true, print: 'p1' } } }, EMPTY, s);
    expect(loadState('k', s)).toEqual({ seen: { a: true }, notes: {}, seenPrints: { a: 'p1' } });
    updateState('k', { seen: { a: { value: false } } }, EMPTY, s);
    expect(s.data.get('k')).toBe(JSON.stringify({ seen: {}, notes: {} }));
  });

  it('eski biçim (seenPrints yok) okunur ve öyle yazılır', () => {
    const s = memory();
    s.setItem('k', JSON.stringify({ seen: { a: true }, notes: {} }));
    expect(loadState('k', s)).toEqual({ seen: { a: true }, notes: {} });
    expect(saveState('k', loadState('k', s), s)).toBe(true);
    expect(s.data.get('k')).toBe(JSON.stringify({ seen: { a: true }, notes: {} }));
  });
});

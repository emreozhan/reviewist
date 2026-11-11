import { describe, expect, it } from 'vitest';
import { sampleReview } from '../mock/sampleReview';
import { structureRows } from './structureRows';

describe('yapı satırları: tip katlama', () => {
  const types = sampleReview.types.slice(0, 3);

  it('katlanmış tipin yalnız başlık satırı çıkar ve son satır işaretlenir', () => {
    const all = structureRows(types, false);
    const first = types[0];
    if (!first) throw new Error('örnek tip yok');
    const folded = structureRows(types, false, new Set([first.id]));
    expect(all.filter((r) => r.type.id === first.id).length).toBeGreaterThan(1);
    const rowsOfFirst = folded.filter((r) => r.type.id === first.id);
    expect(rowsOfFirst).toHaveLength(1);
    expect(rowsOfFirst[0]).toMatchObject({ kind: 'type', first: true, last: true });
    // Diğer tipler etkilenmez.
    expect(folded.filter((r) => r.type.id !== first.id)).toEqual(all.filter((r) => r.type.id !== first.id));
  });
});

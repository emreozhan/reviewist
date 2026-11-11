import { describe, expect, it } from 'vitest';
import { createMemoryChangeSet } from './memoryChangeSet.js';

describe('createMemoryChangeSet', () => {
  it('durumları, satır numaralarını ve sayıları üretir', async () => {
    const cs = createMemoryChangeSet({
      old: { 'a.txt': 'x\ny\nz\n', 'gone.txt': 'g\n', 'old/r.txt': 'r1\nr2\n', 'same.txt': 's\n' },
      new: { 'a.txt': 'x\nY\nz\n', 'new.txt': 'n\n', 'new/r.txt': 'r1\nr2\nr3\n', 'same.txt': 's\n' },
      renames: { 'new/r.txt': 'old/r.txt' },
      extraNewFiles: { 'lib/Other.java': 'class Other {}' },
    });
    const byPath = Object.fromEntries(cs.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(['a.txt', 'gone.txt', 'new.txt', 'new/r.txt']);
    expect(byPath['a.txt'].status).toBe('modified');
    expect(byPath['a.txt'].additions).toBe(1);
    expect(byPath['a.txt'].deletions).toBe(1);
    const lines = byPath['a.txt'].hunks[0].lines;
    expect(lines.find((l) => l.type === 'add')).toEqual({ type: 'add', newNo: 2, text: 'Y' });
    expect(lines.find((l) => l.type === 'del')).toEqual({ type: 'del', oldNo: 2, text: 'y' });
    expect(byPath['gone.txt'].status).toBe('deleted');
    expect(byPath['new.txt'].status).toBe('added');
    expect(byPath['new.txt'].hunks[0].lines[0]).toEqual({ type: 'add', newNo: 1, text: 'n' });
    expect(byPath['new/r.txt']).toMatchObject({ status: 'renamed', oldPath: 'old/r.txt', additions: 1 });

    expect(await cs.readFile('old', 'gone.txt')).toBe('g\n');
    expect(await cs.readFile('new', 'gone.txt')).toBeUndefined();
    expect(await cs.readFile('new', 'old/r.txt')).toBeUndefined();
    expect(await cs.readFile('old', 'lib/Other.java')).toBe('class Other {}');
    expect(await cs.listFiles('new', '.java')).toEqual(['lib/Other.java']);
    expect(await cs.listFiles('new')).toContain('same.txt');
  });

  it('stableKey verilmezse başlıktan üretir, verilirse korur', () => {
    expect(createMemoryChangeSet({ old: {}, new: {} }).info.stableKey).toBe('memory:bellek içi değişiklik');
    expect(createMemoryChangeSet({ old: {}, new: {}, info: { title: 'x...y' } }).info.stableKey).toBe('memory:x...y');
    expect(createMemoryChangeSet({ old: {}, new: {}, info: { stableKey: 'k1' } }).info.stableKey).toBe('k1');
  });
});

import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../lib/apiTypes';
import { mockListFs } from './fsTree';

describe('mock dizin ağacı', () => {
  it('ev dizini, gizli filtre, Türkçe sıralama', () => {
    const home = mockListFs('', false);
    expect(home.path).toBe('C:\\Users\\demo');
    expect(home.parent).toBe('C:\\Users');
    expect(home.entries.map((e) => e.name)).toEqual(['Belgeler', 'Desktop', 'Downloads', 'projeler']);
    expect(mockListFs('', true).entries.some((e) => e.name === 'AppData' && e.hidden)).toBe(true);
    const p = mockListFs('c:/users/demo/projeler', false);
    expect(p.entries.map((e) => e.name)).toEqual(['arşiv', 'çalışma-notları', 'legacy-monolith', 'ödeme-servisi', 'ui-kit']);
    expect(p.entries.find((e) => e.name === 'ui-kit')?.isGitRepo).toBe(true);
  });

  it('depo içi repoRoot, kök, hatalar', () => {
    const sub = mockListFs('C:\\work\\shop\\src\\main', false);
    expect(sub.repoRoot).toBe('C:\\work\\shop');
    expect(mockListFs('C:\\work\\shop', false).isGitRepo).toBe(true);
    const root = mockListFs('C:', false);
    expect(root.path).toBe('C:\\');
    expect(root.parent).toBeUndefined();
    expect(mockListFs('C:\\work', false).parent).toBe('C:\\');
    const status = (p: string): number | undefined => {
      try {
        mockListFs(p, false);
        return 200;
      } catch (e) {
        return e instanceof ApiRequestError ? e.status : undefined;
      }
    };
    expect(status('C:\\yok')).toBe(404);
    expect(status('C:\\Windows')).toBe(403);
    expect(status('göreli')).toBe(400);
  });
});

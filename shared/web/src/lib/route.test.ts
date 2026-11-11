import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from '../components/ErrorBoundary';
import { parseHash, safeDecode } from './route';

describe('güvenli adres çözme', () => {
  it('bozuk % dizisinde fırlatmaz, ham metni kullanır', () => {
    expect(() => parseHash('#/review/%E0%A4%A/workspace')).not.toThrow();
    expect(parseHash('#/review/%E0%A4%A/workspace')).toMatchObject({ name: 'review', id: '%E0%A4%A', tab: 'workspace' });
    expect(parseHash('#/review/abc%/graph?file=%ZZ&sym=%')).toMatchObject({ name: 'review', id: 'abc%', tab: 'graph' });
    expect(safeDecode('%')).toBe('%');
    expect(safeDecode('a%20b')).toBe('a b');
  });

  it('bilinmeyen sekme ve boş adres', () => {
    expect(parseHash('#/review/x/yok')).toMatchObject({ tab: 'workspace' });
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/%')).toEqual({ name: 'home' });
  });
});

describe('hata sınırı', () => {
  it('yüklenemeyen lazy parça hatasını tanır', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:4317/assets/ImpactMap-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('x is undefined'))).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, DEFAULT_FINDING_FILTER } from '../lib/selectors';
import { useUi } from './uiStore';

describe('satır odağı (focusLine)', () => {
  beforeEach(() => {
    useUi.setState({ reviewId: null });
    useUi.getState().resetForReview('r1');
  });

  it('işlenen odak temizlenir; aynı dosyaya dönünce eski satıra kaydırılmaz', () => {
    const ui = useUi.getState();
    ui.goToLine('A.java', 120);
    const first = useUi.getState().focusLine;
    expect(first).toMatchObject({ fileId: 'A.java', line: 120 });
    useUi.getState().clearFocus(first?.tick);
    expect(useUi.getState().focusLine).toBeNull();
    useUi.getState().selectFile('B.java');
    useUi.getState().selectFile('A.java');
    expect(useUi.getState().focusLine).toBeNull();
  });

  it('j/k ile başka dosyaya geçmek bekleyen odağı düşürür', () => {
    useUi.getState().goToLine('A.java', 7);
    useUi.getState().selectFile('B.java');
    expect(useUi.getState().focusLine).toBeNull();
  });

  it('eski isteğin temizliği yeni isteği silmez; tick temizlemeden sonra da artar', () => {
    useUi.getState().goToLine('A.java', 1);
    const t1 = useUi.getState().focusLine?.tick ?? 0;
    useUi.getState().goToLine('A.java', 2);
    const t2 = useUi.getState().focusLine?.tick ?? 0;
    expect(t2).toBeGreaterThan(t1);
    useUi.getState().clearFocus(t1);
    expect(useUi.getState().focusLine?.line).toBe(2);
    useUi.getState().clearFocus(t2);
    useUi.getState().goToLine('A.java', 2);
    expect(useUi.getState().focusLine?.tick).toBeGreaterThan(t2);
  });

  it('aynı dosyada sembol seçimi odağı korur, dosya değişince düşürür', () => {
    useUi.getState().goToLine('A.java', 5);
    useUi.getState().selectSymbol('x.A#m()', 'A.java');
    expect(useUi.getState().focusLine?.line).toBe(5);
    useUi.getState().selectSymbol('x.B#m()', 'B.java');
    expect(useUi.getState().focusLine).toBeNull();
  });
});

describe('inceleme değişimi ve arama odağı', () => {
  beforeEach(() => {
    useUi.setState({ reviewId: null });
    useUi.getState().resetForReview('r1');
  });

  it('arama metni ve filtreler sonraki incelemeye taşınmaz', () => {
    useUi.getState().setFilters({ query: 'Order', hideTests: true });
    useUi.getState().setFindingFilter({ ...DEFAULT_FINDING_FILTER });
    useUi.getState().resetForReview('r1');
    expect(useUi.getState().filters.query).toBe('Order');
    useUi.getState().resetForReview('r2');
    expect(useUi.getState().filters).toEqual(DEFAULT_FILTERS);
    expect(useUi.getState().findingFilter).toEqual(DEFAULT_FINDING_FILTER);
  });

  it('/ odak isteği tek seferlik tüketilir', () => {
    expect(useUi.getState().consumeSearchFocus()).toBe(false);
    useUi.getState().focusSearch();
    expect(useUi.getState().consumeSearchFocus()).toBe(true);
    // Arama kutusu yeniden bağlandı (çalışma alanına dönüş): tekrar odaklanmaz.
    expect(useUi.getState().consumeSearchFocus()).toBe(false);
  });

  it('başka incelemeye geçince bekleyen odak isteği düşer', () => {
    useUi.getState().focusSearch();
    useUi.getState().resetForReview('r3');
    expect(useUi.getState().consumeSearchFocus()).toBe(false);
  });
});

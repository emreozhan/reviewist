import { beforeEach, describe, expect, it } from 'vitest';
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

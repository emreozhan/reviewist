import { describe, expect, it } from 'vitest';
import { sampleReview } from '../mock/sampleReview';
import { buildIndex } from './reviewIndex';
import { findDeclarationLine, guessFilePath, locateSymbol, topLevelTypeId } from './locate';

describe('sembol konumu', () => {
  const index = buildIndex(sampleReview);

  it('üst düzey tip kimliği', () => {
    expect(topLevelTypeId('com.acme.Outer.Inner#m(int)')).toBe('com.acme.Outer');
    expect(topLevelTypeId('com.acme.Foo')).toBe('com.acme.Foo');
  });

  it('diff dışı düğümde sunucunun range bilgisi kullanılır', () => {
    const node = sampleReview.graph.nodes.find((n) => n.status === 'impacted' && n.range);
    expect(node).toBeDefined();
    if (!node) return;
    const loc = locateSymbol(index, node.id);
    expect(loc).toMatchObject({ file: node.file, line: node.range?.startLine, inDiff: false, guessed: false });
  });

  it("rangeSide 'old' ise yeniden adlandırılan dosyanın eski yolu kullanılır", () => {
    const renamed = sampleReview.files.find((f) => f.oldPath && f.oldPath !== f.path);
    expect(renamed).toBeDefined();
    if (!renamed) return;
    const id = 'com.x.Gone#gone()';
    const idx = buildIndex({
      ...sampleReview,
      graph: {
        nodes: [{ id, label: 'Gone.gone()', kind: 'method', status: 'impacted', file: renamed.path, layer: 'other', riskLevel: 'low', range: { startLine: 4, endLine: 6 }, rangeSide: 'old' }],
        edges: [],
      },
    });
    expect(locateSymbol(idx, id)).toMatchObject({ file: renamed.oldPath, line: 4, side: 'old', inDiff: false });
  });

  it('düğüm yoksa dosya yolu paket adından tahmin edilir', () => {
    const t = sampleReview.types[0];
    expect(t).toBeDefined();
    if (!t) return;
    const pkg = t.id.slice(0, t.id.lastIndexOf('.'));
    const id = `${pkg}.port.NotificationPort#notify(Order)`;
    const guess = guessFilePath(index, id);
    expect(guess).toBe(t.file.replace(/[^/]+\.java$/, 'port/NotificationPort.java'));
    const loc = locateSymbol(index, id);
    expect(loc).toMatchObject({ file: guess, guessed: true, inDiff: false });
    expect(loc.line).toBeUndefined();
  });

  it('içerikte bildirim satırı çağrılardan ayırt edilir', () => {
    const lines = [
      'public class Notifier {',
      '  void run() { this.notify(order); }',
      '  Result r = notify(order);',
      '  return notify(order);',
      '  public void notify(Order order) {',
      '  private final Clock clock = Clock.systemUTC();',
      '  Notifier n = new Notifier();',
      '  public Notifier() {}',
    ];
    expect(findDeclarationLine(lines, 'com.x.Notifier#notify(Order)')).toBe(5);
    expect(findDeclarationLine(lines, 'com.x.Notifier')).toBe(1);
    expect(findDeclarationLine(lines, 'com.x.Notifier#clock')).toBe(6);
    expect(findDeclarationLine(lines, 'com.x.Notifier#Notifier()')).toBe(8);
    expect(findDeclarationLine(lines, 'com.x.Notifier#missing()')).toBeUndefined();
  });
});

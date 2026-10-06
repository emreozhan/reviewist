import { describe, expect, it } from 'vitest';
import type { OpenSpec, TabsState } from './tabs';
import {
  activateTab,
  breadcrumb,
  closeOtherTabs,
  closeTab,
  EMPTY_TABS,
  focusInTab,
  MAX_HISTORY,
  MAX_TABS,
  moveTab,
  neighborTab,
  openTab,
  pinTab,
  reconcileInDiff,
  reviveTabs,
  serializeTabs,
  stepHistory,
  tabKey,
} from './tabs';

const spec = (path: string, extra: Partial<OpenSpec> = {}): OpenSpec => ({ path, inDiff: true, label: path.replace('.java', ''), ...extra });
let tick = 0;
const preview = (s: TabsState, path: string, extra?: Partial<OpenSpec>) => openTab(s, spec(path, extra), { preview: true, activate: true, tick: ++tick });
const open = (s: TabsState, path: string, extra?: Partial<OpenSpec>, activate = true) => openTab(s, spec(path, extra), { preview: false, activate, tick: ++tick });

describe('önizleme sekmesi (VS Code davranışı)', () => {
  it('tek tıklama önizleme açar; sonraki tek tıklama aynı sekmeyi değiştirir', () => {
    let s = preview(EMPTY_TABS, 'A.java');
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.preview).toBe(true);
    s = preview(s, 'B.java');
    expect(s.tabs.map((t) => t.path)).toEqual(['B.java']);
    expect(s.activeKey).toBe(tabKey('B.java'));
  });

  it('kalıcı açma önizlemeyi değiştirmez, yanına ekler', () => {
    let s = preview(EMPTY_TABS, 'A.java');
    s = open(s, 'B.java');
    expect(s.tabs.map((t) => [t.path, t.preview])).toEqual([
      ['A.java', true],
      ['B.java', false],
    ]);
    // Yeni önizleme eski önizlemenin yerini alır; kalıcı sekmeye dokunmaz.
    s = preview(s, 'C.java');
    expect(s.tabs.map((t) => t.path)).toEqual(['C.java', 'B.java']);
  });

  it('önizleme sekmesini kalıcı açmak ya da sabitlemek onu kalıcı yapar', () => {
    let s = preview(EMPTY_TABS, 'A.java');
    s = open(s, 'A.java', { symbolId: 'x.A#m()' });
    expect(s.tabs[0]?.preview).toBe(false);
    let p = preview(EMPTY_TABS, 'B.java');
    p = pinTab(p, tabKey('B.java'));
    p = preview(p, 'C.java');
    expect(p.tabs.map((t) => t.path)).toEqual(['B.java', 'C.java']);
  });

  it('açık sekmeyi önizlemeyle seçmek onu önizlemeye çevirmez', () => {
    let s = open(EMPTY_TABS, 'A.java');
    s = preview(s, 'B.java');
    s = preview(s, 'A.java');
    expect(s.tabs.map((t) => [t.path, t.preview])).toEqual([
      ['A.java', false],
      ['B.java', true],
    ]);
    expect(s.activeKey).toBe(tabKey('A.java'));
  });
});

describe('sekme işlemleri', () => {
  it('yeni sekme etkin sekmenin sağına eklenir; arka planda açma öne getirmez', () => {
    let s = open(EMPTY_TABS, 'A.java');
    s = open(s, 'B.java');
    s = activateTab(s, tabKey('A.java'));
    s = open(s, 'C.java', {}, false);
    expect(s.tabs.map((t) => t.path)).toEqual(['A.java', 'C.java', 'B.java']);
    expect(s.activeKey).toBe(tabKey('A.java'));
  });

  it('açık sekmeye metotla gelmek odağı ve sayacı günceller', () => {
    let s = open(EMPTY_TABS, 'A.java', { symbolId: 'x.A#a()', line: 3 });
    const t1 = s.tabs[0]?.tick ?? 0;
    s = open(s, 'A.java', { symbolId: 'x.A#b()', line: 9 });
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ symbolId: 'x.A#b()', line: 9 });
    expect(s.tabs[0]?.tick).toBeGreaterThan(t1);
  });

  it('kapatma: etkin sekme kapanınca sağdaki, yoksa soldaki öne gelir', () => {
    let s = open(EMPTY_TABS, 'A.java');
    s = open(s, 'B.java');
    s = open(s, 'C.java');
    s = activateTab(s, tabKey('B.java'));
    s = closeTab(s, tabKey('B.java'));
    expect(s.activeKey).toBe(tabKey('C.java'));
    s = closeTab(s, tabKey('C.java'));
    expect(s.activeKey).toBe(tabKey('A.java'));
    s = closeTab(s, tabKey('A.java'));
    expect(s.activeKey).toBeNull();
  });

  it('diğerlerini kapat, sürükle-bırak sıralama ve döngüsel komşu', () => {
    let s = open(EMPTY_TABS, 'A.java');
    s = open(s, 'B.java');
    s = open(s, 'C.java');
    s = moveTab(s, tabKey('C.java'), tabKey('A.java'));
    expect(s.tabs.map((t) => t.path)).toEqual(['C.java', 'A.java', 'B.java']);
    expect(neighborTab(s, 1)).toBe(tabKey('A.java'));
    expect(neighborTab(s, -1)).toBe(tabKey('B.java'));
    s = closeOtherTabs(s, tabKey('A.java'));
    expect(s.tabs.map((t) => t.path)).toEqual(['A.java']);
    expect(s.activeKey).toBe(tabKey('A.java'));
  });

  it('eski taraf (silinmiş sembol) ayrı sekmedir', () => {
    let s = open(EMPTY_TABS, 'A.java');
    s = open(s, 'A.java', { side: 'old', inDiff: false });
    expect(s.tabs.map((t) => t.key)).toEqual(['new:A.java', 'old:A.java']);
  });

  it(`en fazla ${MAX_TABS} sekme: önce önizleme, sonra en soldaki kapanır`, () => {
    let s = preview(EMPTY_TABS, 'P.java');
    for (let i = 0; i < MAX_TABS + 3; i++) s = open(s, `F${i}.java`);
    expect(s.tabs).toHaveLength(MAX_TABS);
    expect(s.tabs.some((t) => t.path === 'P.java')).toBe(false);
    expect(s.activeKey).toBe(tabKey(`F${MAX_TABS + 2}.java`));
  });
});

describe('gezinme geçmişi', () => {
  it('atlamalar kaydedilir; geri/ileri imleci taşır ve uygulanacak kaydı verir', () => {
    let s = open(EMPTY_TABS, 'A.java', { symbolId: 'A#notify', crumb: 'A.notify' });
    s = open(s, 'B.java', { symbolId: 'B#deliver', crumb: 'B.deliver' });
    s = open(s, 'C.java', { symbolId: 'C#send', crumb: 'C.send' });
    expect(breadcrumb(s).map((b) => b.entry.crumb)).toEqual(['A.notify', 'B.deliver', 'C.send']);
    const back = stepHistory(s, -1);
    expect(back?.entry.crumb).toBe('B.deliver');
    s = back?.state ?? s;
    // Kaydın uygulanması (sekmeye geçiş) yeni kayıt eklemez: aynı sekme + sembol.
    s = open(s, 'B.java', { symbolId: 'B#deliver', crumb: 'B.deliver' });
    expect(s.history).toHaveLength(3);
    expect(s.cursor).toBe(1);
    expect(breadcrumb(s).map((b) => [b.entry.crumb, b.current, b.forward])).toEqual([
      ['A.notify', false, false],
      ['B.deliver', true, false],
      ['C.send', false, true],
    ]);
    expect(stepHistory(s, 1)?.entry.crumb).toBe('C.send');
  });

  it('geri gidildikten sonra yeni atlama ileri kayıtları atar', () => {
    let s = open(EMPTY_TABS, 'A.java', { symbolId: 'a' });
    s = open(s, 'B.java', { symbolId: 'b' });
    s = stepHistory(s, -1)?.state ?? s;
    s = open(s, 'C.java', { symbolId: 'c' });
    expect(s.history.map((e) => e.symbolId)).toEqual(['a', 'c']);
    expect(stepHistory(s, 1)).toBeNull();
  });

  it('aynı sekmede sembol değişimi kayıt ekler; sembol temizliği eklemez', () => {
    let s = open(EMPTY_TABS, 'A.java');
    s = focusInTab(s, tabKey('A.java'), { symbolId: 'A#x', tick: 1 });
    s = focusInTab(s, tabKey('A.java'), { symbolId: undefined, tick: 2 });
    expect(s.history.map((e) => e.symbolId)).toEqual([undefined, 'A#x']);
  });

  it(`geçmiş ${MAX_HISTORY} kayıtla sınırlıdır`, () => {
    let s = EMPTY_TABS;
    for (let i = 0; i < MAX_HISTORY + 10; i++) s = open(s, `F${i % 5}.java`, { symbolId: `s${i}` });
    expect(s.history).toHaveLength(MAX_HISTORY);
    expect(s.cursor).toBe(MAX_HISTORY - 1);
  });
});

describe('kalıcılık', () => {
  it('serileştirip geri yükler; inDiff güncel incelemeden yeniden hesaplanır', () => {
    let s = open(EMPTY_TABS, 'A.java', { symbolId: 'a' });
    s = open(s, 'Out.java', { inDiff: false, symbolId: 'o' });
    s = open(s, 'Gone.java');
    const raw = JSON.parse(JSON.stringify(serializeTabs(s))) as unknown;
    // Yeni analizde: Out.java artık değişmiş (diff'te), Gone.java artık değişmemiş.
    const back = reviveTabs(raw, (p) => p !== 'Gone.java');
    expect(back.tabs.map((t) => [t.path, t.inDiff])).toEqual([
      ['A.java', true],
      ['Out.java', true],
      ['Gone.java', false],
    ]);
    expect(back.activeKey).toBe(tabKey('Gone.java'));
    expect(back.history.map((e) => [e.path, e.inDiff])).toEqual([
      ['A.java', true],
      ['Out.java', true],
      ['Gone.java', false],
    ]);
    expect(back.cursor).toBe(2);
  });

  it('bellekteki sekmeler yeniden analizde uzlaştırılır; değişiklik yoksa aynı nesne', () => {
    let s = open(EMPTY_TABS, 'A.java');
    s = open(s, 'Out.java', { inDiff: false });
    expect(reconcileInDiff(s, (p) => p === 'A.java')).toBe(s);
    const r = reconcileInDiff(s, () => true);
    expect(r.tabs.find((t) => t.path === 'Out.java')?.inDiff).toBe(true);
    expect(r.history.every((e) => e.inDiff)).toBe(true);
    const old = openTab(EMPTY_TABS, { path: 'Del.java', side: 'old', inDiff: false, label: 'Del' }, { preview: false, activate: true, tick: 1 });
    // Eski taraf sekmesi diff sekmesine çevrilmez.
    expect(reconcileInDiff(old, () => true)).toBe(old);
  });

  it('bozuk kayıt boş duruma düşer', () => {
    expect(reviveTabs('x', () => true)).toEqual(EMPTY_TABS);
    expect(reviveTabs({ tabs: [{ nope: 1 }], cursor: 99 }, () => true)).toEqual({ tabs: [], activeKey: null, history: [], cursor: -1 });
  });
});

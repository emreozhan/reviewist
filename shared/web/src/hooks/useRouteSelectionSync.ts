import { useEffect, useRef } from 'react';
import type { ReviewModel } from '../../../src/shared/types';
import { legacyStorageKey, storageKey } from '../lib/persistence';
import type { ReviewIndex } from '../lib/reviewIndex';
import type { RouteParams, Tab } from '../lib/route';
import { formatHash, parseHash, writeHash } from '../lib/route';
import { orderedEntries, planView } from '../lib/selectors';
import type { EditorTab } from '../lib/tabs';
import { activeTab, tabKey } from '../lib/tabs';
import { useProgress } from '../state/progressStore';
import { useTabs } from '../state/tabsStore';
import { useUi } from '../state/uiStore';
import { useCodeNav } from './useCodeNav';

/**
 * Adres (hash) ile seçim (dosya/sembol/görünüm/düzen) ve etkin sekme arasında iki yönlü senkron:
 * ilk açılışta adres uygulanır (yoksa kayıtlı etkin sekme, o da yoksa plandaki ilk dosya);
 * seçim/etkin sekme değişince adrese yazılır (dosya/sembol değişimi geçmişe eklenir);
 * geri/ileri ya da elle düzenlenen adres seçime uygulanır. Adres yalnız etkin sekmeyi tutar.
 */
export function useRouteSelectionSync(review: ReviewModel, index: ReviewIndex, tab: Tab, params: RouteParams): void {
  const applied = useRef(false);
  /** Bu bileşenin adrese en son yazdığı hash: kendi yazdığımızı adresten geri uygulamayalım. */
  const lastWritten = useRef<string | null>(null);
  const appliedParams = useRef<RouteParams | null>(null);
  const selectedFileId = useUi((s) => s.selectedFileId);
  const selectedSymbolId = useUi((s) => s.selectedSymbolId);
  const centerView = useUi((s) => s.centerView);
  const diffLayout = useUi((s) => s.diffLayout);
  const active = useTabs((s) => activeTab(s));
  const nav = useCodeNav();
  const navRef = useRef(nav);
  navRef.current = nav;

  const openSource = (p: RouteParams) => {
    if (!p.src) return;
    const side = p.side ?? 'new';
    const cur = activeTab(useTabs.getState());
    if (cur && cur.key === tabKey(p.src, side) && cur.symbolId === p.sym) return;
    const node = p.sym ? index.nodeById.get(p.sym) : undefined;
    navRef.current.openTarget({ path: p.src, side, inDiff: false, symbolId: p.sym, line: node?.range?.startLine, endLine: node?.range?.endLine, typeId: node?.typeId });
  };

  // İlk açılış: kalıcı durumu yükle, adresteki seçimi uygula; yoksa kayıtlı etkin sekme ya da plandaki ilk dosya.
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    useProgress.getState().init(storageKey(review), legacyStorageKey(review), Object.fromEntries(index.fingerprintByFile));
    const ui = useUi.getState();
    ui.resetForReview(review.id);
    if (params.layout) ui.setDiffLayout(params.layout);
    const file = params.file && index.fileById.has(params.file) ? params.file : undefined;
    const restored: EditorTab | undefined = activeTab(useTabs.getState());
    if (params.src) openSource(params);
    else if (file && params.line) ui.goToLine(file, params.line, params.sym);
    else if (file && params.sym) ui.selectSymbol(params.sym, file);
    else if (file) ui.selectFile(file);
    else if (restored) navRef.current.activateTab(restored, { skipHistory: true });
    else if (!useUi.getState().selectedFileId) {
      // Katlı özet bölümlerindeki (kozmetik, düşük riskli Java dışı) dosyalar başlangıç seçimi olmaz.
      const first = planView(review, index, ui.filters).main[0] ?? orderedEntries(review, index)[0];
      if (first) ui.selectFile(first.file.id);
    }
    if (file && params.view) useUi.getState().setCenterView(params.view);
    appliedParams.current = params;
  }, [review, index, params]);

  // Adres değişti (geri/ileri, elle düzenleme): seçimi / etkin sekmeyi adrese uydur.
  useEffect(() => {
    if (!applied.current || appliedParams.current === params) return;
    appliedParams.current = params;
    const own = lastWritten.current !== null && lastWritten.current === window.location.hash;
    lastWritten.current = null;
    if (own) return;
    if (params.src) {
      openSource(params);
      return;
    }
    const ui = useUi.getState();
    // Sekme geçişi gibi dosyasız adresler mevcut seçimi korur.
    const file = params.file && index.fileById.has(params.file) ? params.file : undefined;
    if (!file) return;
    const sym = params.sym ?? null;
    const cur = activeTab(useTabs.getState());
    const tabElsewhere = !cur || cur.key !== tabKey(file);
    if (tabElsewhere || file !== ui.selectedFileId || sym !== ui.selectedSymbolId) {
      if (params.line) ui.goToLine(file, params.line, params.sym);
      else if (sym) ui.selectSymbol(sym, file);
      else ui.selectFile(file);
    }
    // Satıra gitme (line) diff görünümünde olur: adreste görünüm yoksa diff varsayılır.
    const view = params.view ?? (params.line ? 'diff' : null);
    if (view !== useUi.getState().centerView) ui.setCenterView(view);
    const layout = params.layout ?? 'unified';
    if (layout !== useUi.getState().diffLayout) ui.setDiffLayout(layout);
  }, [params, index]);

  // Seçimi / etkin sekmeyi adres çubuğuna yansıt (paylaşılabilir bağlantı, yenilemede korunur, geri/ileri çalışır).
  useEffect(() => {
    if (!applied.current) return;
    // Sekme adresten okunur: aynı anda yapılan sekme geçişini (navigate) eski prop ile ezmemek için.
    const current = parseHash(window.location.hash);
    if (current.name !== 'review' || current.id !== review.id) return;
    const outside = active && !active.inDiff;
    const next: RouteParams = outside
      ? { src: active.path, sym: active.symbolId, side: active.side === 'old' ? 'old' : undefined }
      : {
          file: selectedFileId ?? undefined,
          sym: selectedSymbolId ?? undefined,
          view: centerView ?? undefined,
          layout: diffLayout === 'split' ? ('split' as const) : undefined,
        };
    // Dosya/sembol seçimi yeni geçmiş kaydı açar; görünüm/düzen değişimi ve ilk yazım mevcut kaydı günceller.
    const hadTarget = current.params.file !== undefined || current.params.src !== undefined;
    const push = hadTarget && (current.params.file !== next.file || current.params.src !== next.src || current.params.sym !== next.sym);
    const route = { name: 'review' as const, id: review.id, tab: current.tab, params: next };
    if (formatHash(route) === window.location.hash) return;
    lastWritten.current = writeHash(route, push);
  }, [review.id, tab, selectedFileId, selectedSymbolId, centerView, diffLayout, active]);
}

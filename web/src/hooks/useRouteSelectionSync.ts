import { useEffect, useRef } from 'react';
import type { ReviewModel } from '../../../src/shared/types';
import { legacyStorageKey, storageKey } from '../lib/persistence';
import type { ReviewIndex } from '../lib/reviewIndex';
import type { RouteParams, Tab } from '../lib/route';
import { formatHash, parseHash, writeHash } from '../lib/route';
import { orderedEntries, planView } from '../lib/selectors';
import { useProgress } from '../state/progressStore';
import { useUi } from '../state/uiStore';

/**
 * Adres (hash) ile seçim (dosya/sembol/görünüm/düzen) arasında iki yönlü senkron:
 * ilk açılışta adres uygulanır; seçim değişince adrese yazılır (dosya/sembol değişimi geçmişe eklenir);
 * geri/ileri ya da elle düzenlenen adres seçime uygulanır.
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

  // İlk açılış: kalıcı durumu yükle, adresteki seçimi uygula ya da plandaki ilk dosyayı seç.
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    useProgress.getState().init(storageKey(review), legacyStorageKey(review));
    const ui = useUi.getState();
    ui.resetForReview(review.id);
    if (params.layout) ui.setDiffLayout(params.layout);
    const file = params.file && index.fileById.has(params.file) ? params.file : undefined;
    if (file && params.line) ui.goToLine(file, params.line, params.sym);
    else if (file && params.sym) ui.selectSymbol(params.sym, file);
    else if (file) ui.selectFile(file);
    else if (!useUi.getState().selectedFileId) {
      // Katlı özet bölümlerindeki (kozmetik, düşük riskli Java dışı) dosyalar başlangıç seçimi olmaz.
      const first = planView(review, index, ui.filters).main[0] ?? orderedEntries(review, index)[0];
      if (first) ui.selectFile(first.file.id);
    }
    if (file && params.view) useUi.getState().setCenterView(params.view);
    appliedParams.current = params;
  }, [review, index, params]);

  // Adres değişti (geri/ileri, elle düzenleme): seçimi adrese uydur.
  useEffect(() => {
    if (!applied.current || appliedParams.current === params) return;
    appliedParams.current = params;
    const own = lastWritten.current !== null && lastWritten.current === window.location.hash;
    lastWritten.current = null;
    if (own) return;
    const ui = useUi.getState();
    // Sekme geçişi gibi dosyasız adresler mevcut seçimi korur.
    const file = params.file && index.fileById.has(params.file) ? params.file : undefined;
    if (!file) return;
    const sym = params.sym ?? null;
    if (file !== ui.selectedFileId || sym !== ui.selectedSymbolId) {
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

  // Seçimi adres çubuğuna yansıt (paylaşılabilir bağlantı, yenilemede korunur, geri/ileri çalışır).
  useEffect(() => {
    if (!applied.current) return;
    // Sekme adresten okunur: aynı anda yapılan sekme geçişini (navigate) eski prop ile ezmemek için.
    const current = parseHash(window.location.hash);
    if (current.name !== 'review' || current.id !== review.id) return;
    const next = {
      file: selectedFileId ?? undefined,
      sym: selectedSymbolId ?? undefined,
      view: centerView ?? undefined,
      layout: diffLayout === 'split' ? ('split' as const) : undefined,
    };
    // Dosya/sembol seçimi yeni geçmiş kaydı açar; görünüm/düzen değişimi ve ilk yazım mevcut kaydı günceller.
    const push = current.params.file !== undefined && (current.params.file !== next.file || current.params.sym !== next.sym);
    const route = { name: 'review' as const, id: review.id, tab: current.tab, params: next };
    if (formatHash(route) === window.location.hash) return;
    lastWritten.current = writeHash(route, push);
  }, [review.id, tab, selectedFileId, selectedSymbolId, centerView, diffLayout]);

}

import { useEffect } from 'react';
import type { ReviewModel } from '../../../src/shared/types';
import { crumbFor, tabLabelFor } from '../lib/navTarget';
import type { ReviewIndex } from '../lib/reviewIndex';
import { storageKey } from '../lib/persistence';
import { rememberReviewKeys } from '../lib/reviewKeys';
import { tabKey } from '../lib/tabs';
import { useProgress } from '../state/progressStore';
import { tabsStorageKey, useTabs } from '../state/tabsStore';
import { useUi } from '../state/uiStore';

/**
 * Seçim (gezgin, j/k, plan, arama…) → sekme senkronu: yeni dosya seçimi önizleme sekmesi açar
 * (ya da açık sekmesine geçer), dosya içi sembol seçimi etkin sekmenin odağını günceller.
 * Görüldü işareti / not yazmak ilgili sekmeyi kalıcı yapar.
 * ReviewLayout'ta useRouteSelectionSync'ten ÖNCE çağrılmalı (ilk seçim bu abonelikle yakalanır).
 */
export function useTabSync(review: ReviewModel, index: ReviewIndex): void {
  useEffect(() => {
    const tabsKey = tabsStorageKey(review.source.stableKey || review.id);
    useTabs.getState().init(tabsKey, (p) => index.fileById.has(p));
    // Silme sırasında temizlenebilsin diye bu incelemenin kayıt anahtarları not edilir.
    rememberReviewKeys(review.id, { progress: storageKey(review), tabs: tabsKey });

    const reconcile = () => {
      const ui = useUi.getState();
      const f = ui.selectedFileId;
      if (!f || !index.fileById.has(f)) return;
      const tabs = useTabs.getState();
      const key = tabKey(f);
      const sym = ui.selectedSymbolId ?? undefined;
      const label = tabLabelFor(index, f);
      const crumb = crumbFor(index, sym, label);
      const existing = tabs.tabs.find((t) => t.key === key);
      if (!existing) {
        tabs.open({ path: f, inDiff: true, label, symbolId: sym, crumb }, { preview: true, activate: true });
        return;
      }
      if (tabs.activeKey !== key) tabs.activate(key);
      if (existing.symbolId !== sym) useTabs.getState().focus(key, { symbolId: sym, crumb }, sym !== undefined);
    };

    let lastSeq = useUi.getState().selectionSeq;
    const unsubUi = useUi.subscribe((s) => {
      if (s.selectionSeq === lastSeq) return;
      lastSeq = s.selectionSeq;
      reconcile();
    });

    const unsubProgress = useProgress.subscribe((s, prev) => {
      if (s.key !== prev.key) return;
      const tabs = useTabs.getState();
      // Başka sekmeden gelen güncelleme (storage olayı) burada sekme sabitlemez: yalnız kullanıcının kendi yazımı.
      if (s.stored === prev.stored || s.origin !== 'local') return;
      for (const k of new Set([...Object.keys(s.seen), ...Object.keys(prev.seen)])) if (!!s.seen[k] !== !!prev.seen[k]) tabs.pinPath(k);
      for (const k of Object.keys(s.notes)) {
        if (s.notes[k] === prev.notes[k]) continue;
        if (k.startsWith('file:')) tabs.pinPath(k.slice(5));
        else if (k.startsWith('sym:')) {
          const file = index.symbolFile.get(k.slice(4));
          if (file) tabs.pinPath(file);
        }
      }
    });

    return () => {
      unsubUi();
      unsubProgress();
    };
  }, [review, index]);
}

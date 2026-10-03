import { useCallback, useMemo, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { ImpactNodeStatus, SymbolRef } from '../../../../src/shared/types';
import { SymbolMenu } from '../../components/SymbolMenu';
import { useOutline } from '../../hooks/queries';
import { useCodeNav } from '../../hooks/useCodeNav';
import { CONFIDENCE_LABEL, STATUS_META } from '../../lib/labels';
import type { RefSpan } from '../../lib/refMerge';
import { refsByLine, refSpansFor } from '../../lib/refMerge';
import type { ReviewIndex } from '../../lib/reviewIndex';
import { shortId, symbolLabel } from '../../lib/reviewIndex';
import { useReviewCtx } from '../workspace/ReviewContext';

/** Değişmiş hedefin durumu (değişmeyen/etkilenen için undefined: bağlantıda nokta çıkmaz). */
export function changedStatusOf(index: ReviewIndex, id: string): ImpactNodeStatus | undefined {
  const s = index.memberById.get(id)?.status ?? index.typeById.get(id)?.status;
  return s && s !== 'unchanged' ? s : undefined;
}

function targetLine(index: ReviewIndex, id: string): string {
  const sig = index.memberById.get(id)?.signature;
  const status = changedStatusOf(index, id);
  const where = index.symbolFile.has(id) ? '' : ' · diff dışı';
  return `${symbolLabel(index, id)}${sig ? ` — ${sig}` : ''}${status ? ` · ${STATUS_META[status].label}` : where}`;
}

/** Bağlantı ipucu: hedef imzası ve durumu (çok hedefte ilk üçü). */
export function refTitle(index: ReviewIndex, r: SymbolRef): string {
  const head = r.targets.length > 1 ? `${r.targets.length} olası hedef (seçmek için tıklayın):\n` : '';
  const list = r.targets.slice(0, 3).map((id) => targetLine(index, id)).join('\n');
  const more = r.targets.length > 3 ? `\n+${r.targets.length - 3} daha` : '';
  const conf = r.confidence && r.confidence !== 'exact' ? `\nEşleşme: ${CONFIDENCE_LABEL[r.confidence]}` : '';
  return `${head}${list}${more}${conf}\nTık: sınıfını sekmede aç · Ctrl+tık: arka planda`;
}

export interface CodeRefs {
  /** Satır no → referans sarmalayıcı aralıkları (outline yoksa null: koddan gezinme kapalı). */
  spans: Map<number, RefSpan[]> | null;
  handlers: {
    onClick: (e: MouseEvent) => void;
    onAuxClick: (e: MouseEvent) => void;
    onMouseDown: (e: MouseEvent) => void;
  };
  /** Çok hedefli referans için seçim menüsü (çizilmeli). */
  menu: ReactNode;
  /** Outline isteniyor (büyük review'da sunucu indeksi yeniden kurarken birkaç saniye sürebilir). */
  loading: boolean;
}

/**
 * Koddan gezinme: dosyanın `outline.refs` konumlarını tıklanabilir bağlantıya çevirir ve tıklamaları
 * (olay devri ile) karşılar. Tek hedef → sınıfı yeni sekmede öne gelir; birden çok hedef → seçim menüsü.
 * Outline ucu yoksa (eski sunucu) `spans` null kalır ve kod düz gösterilir.
 */
export function useCodeRefs(path: string | undefined, side: 'old' | 'new', enabled: boolean): CodeRefs {
  const { review, index } = useReviewCtx();
  const nav = useCodeNav();
  const outline = useOutline(review.id, path, side, enabled && !!path);
  const refMap = useMemo(() => (outline.data ? refsByLine(outline.data.refs) : null), [outline.data]);
  const spans = useMemo(() => {
    if (!refMap) return null;
    const statusOf = (id: string) => changedStatusOf(index, id);
    const titleOf = (r: SymbolRef) => refTitle(index, r);
    const out = new Map<number, RefSpan[]>();
    for (const [ln, refs] of refMap) out.set(ln, refSpansFor(ln, refs, statusOf, titleOf));
    return out;
  }, [refMap, index]);
  const [menu, setMenu] = useState<{ ref: SymbolRef; x: number; y: number } | null>(null);

  const handle = useCallback(
    (e: MouseEvent, background: boolean) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-ri]');
      if (!el || !refMap) return;
      const ref = refMap.get(Number(el.dataset.ln))?.[Number(el.dataset.ri)];
      if (!ref || ref.targets.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (ref.targets.length > 1) {
        setMenu({ ref, x: e.clientX, y: e.clientY + 10 });
        return;
      }
      const target = ref.targets[0];
      if (target) void nav.openSymbol(target, { background });
    },
    [refMap, nav],
  );

  const handlers = useMemo(
    () => ({
      onClick: (e: MouseEvent) => {
        // Metin seçerken bağlantı tetiklenmesin.
        if (window.getSelection()?.toString()) return;
        handle(e, e.ctrlKey || e.metaKey);
      },
      onAuxClick: (e: MouseEvent) => {
        if (e.button === 1) handle(e, true);
      },
      onMouseDown: (e: MouseEvent) => {
        if (e.button === 1 && (e.target as HTMLElement | null)?.closest('[data-ri]')) e.preventDefault();
      },
    }),
    [handle],
  );

  const menuEl = menu ? (
    <SymbolMenu
      title={`${menu.ref.name}: ${menu.ref.targets.length} hedef`}
      at={{ x: menu.x, y: menu.y }}
      items={menu.ref.targets.map((id) => ({
        key: id,
        label: index.symbolFile.has(id) || index.nodeById.has(id) ? symbolLabel(index, id) : shortId(id),
        detail: index.memberById.get(id)?.signature ?? id.slice(id.indexOf('#') + 1),
        status: changedStatusOf(index, id) ?? (index.symbolFile.has(id) ? 'unchanged' : 'impacted'),
        note: index.symbolFile.has(id) ? undefined : 'diff dışı',
      }))}
      onPick={(item, background) => void nav.openSymbol(item.key, { background })}
      onClose={() => setMenu(null)}
    />
  ) : null;

  return { spans, handlers, menu: menuEl, loading: outline.isFetching };
}

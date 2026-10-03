import { useMemo } from 'react';
import { toSplitRows } from '../../lib/diffPresentation';
import { splitItems } from '../../lib/diffItems';
import type { SplitItem } from '../../lib/diffItems';
import { BoundaryRow } from './BoundaryRow';
import { GapCell } from './GapCell';
import { PadRow } from './PadRow';
import { SplitSideCells } from './SplitSideCells';
import type { DiffTableProps } from './UnifiedTable';
import { useFocusIndex } from './useFocusIndex';
import { useRowWindow } from './useRowWindow';

const COLS = 5;

/** Yan yana diff: sol eski, sağ yeni. Uzun dosyalarda yalnız görünen satırlar çizilir. */
export function SplitTable({ rows, lang, oldHl, newHl, oldMap, newMap, selectedSymbolId, onSelectSymbol, onExpand, focus, onFocusMissing, onFocusDone, label, refSpans }: DiffTableProps) {
  const split = useMemo(() => toSplitRows(rows), [rows]);
  const items = useMemo(() => splitItems(split, { oldMap, newMap }), [split, oldMap, newMap]);
  const focusAt = useFocusIndex(items, focus, onFocusMissing);
  const win = useRowWindow(items, focusAt, onFocusDone);

  const renderItem = (item: SplitItem, vi: number) => {
    if (item.kind === 'gap') return <GapCell key={item.key} vi={vi} gap={item.gap} colSpan={COLS} onExpand={onExpand} />;
    if (item.kind === 'boundary') {
      return <BoundaryRow key={item.key} vi={vi} mark={item.mark} colSpan={COLS} selected={item.mark.id === selectedSymbolId} onSelect={onSelectSymbol} />;
    }
    const { row, mark } = item;
    return (
      <tr
        key={item.key}
        data-vi={vi}
        className={`dl dl--pair${mark && mark.id === selectedSymbolId ? ' is-in-selected' : ''}`}
        data-new={row.right?.line.newNo}
        data-old={row.left?.line.oldNo}
      >
        <td className={`dl__rail${mark ? ` st-line--${mark.status}` : ''}`} aria-hidden="true" />
        <SplitSideCells side={row.left} which="old" lang={lang} oldHl={oldHl} newHl={newHl} />
        <SplitSideCells
          side={row.right}
          which="new"
          lang={lang}
          oldHl={oldHl}
          newHl={newHl}
          refSpans={row.right?.line.newNo !== undefined ? refSpans?.get(row.right.line.newNo) : undefined}
        />
      </tr>
    );
  };

  return (
    <table className="dt dt--split" aria-label={label} aria-rowcount={win.windowed ? items.length : undefined}>
      <colgroup>
        <col className="dt__c-rail" />
        <col className="dt__c-no" />
        <col className="dt__c-half" />
        <col className="dt__c-no" />
        <col className="dt__c-half" />
      </colgroup>
      <tbody ref={win.bodyRef}>
        <PadRow height={win.padTop} colSpan={COLS} />
        {items.slice(win.start, win.end).map((it, i) => renderItem(it, win.start + i))}
        <PadRow height={win.padBottom} colSpan={COLS} />
      </tbody>
    </table>
  );
}

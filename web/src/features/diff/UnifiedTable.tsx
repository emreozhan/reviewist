import { useMemo } from 'react';
import type { DiffRow } from '../../lib/diffRows';
import type { SymbolMark } from '../../lib/diffPresentation';
import { lineHtml, wordSegmentsForRows } from '../../lib/diffPresentation';
import { unifiedItems } from '../../lib/diffItems';
import type { UnifiedItem } from '../../lib/diffItems';
import type { HlLang } from '../../lib/highlight';
import { BoundaryRow } from './BoundaryRow';
import { DiffCode } from './DiffCode';
import { GapCell } from './GapCell';
import { PadRow } from './PadRow';
import type { FocusRequest } from './useFocusIndex';
import { useFocusIndex } from './useFocusIndex';
import { useRowWindow } from './useRowWindow';

export type { FocusRequest } from './useFocusIndex';

export interface DiffTableProps {
  rows: DiffRow[];
  lang: HlLang | null;
  oldHl: string[] | null;
  newHl: string[] | null;
  /** Verilirse üye sınırları gösterilir. */
  oldMap?: Map<number, SymbolMark>;
  newMap?: Map<number, SymbolMark>;
  selectedSymbolId?: string | null;
  onSelectSymbol?: (id: string) => void;
  onExpand?: (gapId: string) => void;
  /** Yeni taraftaki bu satıra kaydırılır ve vurgulanır. */
  focus?: FocusRequest | null;
  /** Odak satırı tabloda yoksa (kapalı bağlamda) çağrılır. */
  onFocusMissing?: () => void;
  /** Odak satırına kaydırılıp vurgulandıktan sonra çağrılır (istek temizlenir). */
  onFocusDone?: (tick: number) => void;
  label: string;
}

const SIGN = { add: '+', del: '−', context: ' ' } as const;
const COLS = 5;

export function UnifiedTable({ rows, lang, oldHl, newHl, oldMap, newMap, selectedSymbolId, onSelectSymbol, onExpand, focus, onFocusMissing, onFocusDone, label }: DiffTableProps) {
  const segments = useMemo(() => wordSegmentsForRows(rows), [rows]);
  const items = useMemo(() => unifiedItems(rows, { oldMap, newMap }), [rows, oldMap, newMap]);
  const focusAt = useFocusIndex(items, focus, onFocusMissing);
  const win = useRowWindow(items, focusAt, onFocusDone);

  const renderItem = (item: UnifiedItem, vi: number) => {
    if (item.kind === 'gap') return <GapCell key={item.key} vi={vi} gap={item.gap} colSpan={COLS} onExpand={onExpand} />;
    if (item.kind === 'boundary') {
      return <BoundaryRow key={item.key} vi={vi} mark={item.mark} colSpan={COLS} selected={item.mark.id === selectedSymbolId} onSelect={onSelectSymbol} />;
    }
    const { line, mark } = item;
    return (
      <tr
        key={item.key}
        data-vi={vi}
        className={`dl dl--${line.type}${mark && mark.id === selectedSymbolId ? ' is-in-selected' : ''}`}
        data-old={line.oldNo}
        data-new={line.type === 'del' ? undefined : line.newNo}
      >
        <td className={`dl__rail${mark ? ` st-line--${mark.status}` : ''}`} aria-hidden="true" />
        <td className="dl__no">{line.oldNo ?? ''}</td>
        <td className="dl__no">{line.newNo ?? ''}</td>
        <td className="dl__sign" aria-label={line.type === 'add' ? 'eklendi' : line.type === 'del' ? 'silindi' : undefined}>
          {SIGN[line.type]}
        </td>
        <td className="dl__code">
          <DiffCode line={line} lang={lang} segments={segments.get(item.rowIndex)} html={lineHtml(line, oldHl, newHl)} />
        </td>
      </tr>
    );
  };

  return (
    <table className="dt dt--unified" aria-label={label} aria-rowcount={win.windowed ? items.length : undefined}>
      <colgroup>
        <col className="dt__c-rail" />
        <col className="dt__c-no" />
        <col className="dt__c-no" />
        <col className="dt__c-sign" />
        <col />
      </colgroup>
      <tbody ref={win.bodyRef}>
        <PadRow height={win.padTop} colSpan={COLS} />
        {items.slice(win.start, win.end).map((it, i) => renderItem(it, win.start + i))}
        <PadRow height={win.padBottom} colSpan={COLS} />
      </tbody>
    </table>
  );
}

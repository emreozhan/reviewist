import { markFor, toSplitRows } from '../../lib/diffPresentation';
import { BoundaryRow } from './BoundaryRow';
import { GapCell } from './GapCell';
import { SplitSideCells } from './SplitSideCells';
import type { DiffTableProps } from './UnifiedTable';

/** Yan yana diff: sol eski, sağ yeni. */
export function SplitTable({ rows, lang, oldHl, newHl, oldMap, newMap, selectedSymbolId, onSelectSymbol, onExpand, label }: DiffTableProps) {
  const split = toSplitRows(rows);
  let prevMark: string | undefined;
  return (
    <table className="dt dt--split" aria-label={label}>
      <colgroup>
        <col className="dt__c-rail" />
        <col className="dt__c-no" />
        <col className="dt__c-half" />
        <col className="dt__c-no" />
        <col className="dt__c-half" />
      </colgroup>
      <tbody>
        {split.map((row, i) => {
          if (row.kind === 'gap') {
            prevMark = undefined;
            return <GapCell key={`gap-${row.id}`} gap={row} colSpan={5} onExpand={onExpand} />;
          }
          const ref = row.right?.line ?? row.left?.line;
          const mark = ref && oldMap && newMap ? markFor(ref, oldMap, newMap) : undefined;
          const boundary = mark && mark.id !== prevMark ? mark : undefined;
          prevMark = mark?.id;
          const newNo = row.right?.line.newNo;
          return [
            boundary && <BoundaryRow key={`b-${i}`} mark={boundary} colSpan={5} selected={boundary.id === selectedSymbolId} onSelect={onSelectSymbol} />,
            <tr key={`p-${i}`} className={`dl dl--pair${mark && mark.id === selectedSymbolId ? ' is-in-selected' : ''}`} data-new={newNo} data-old={row.left?.line.oldNo}>
              <td className={`dl__rail${mark ? ` st-line--${mark.status}` : ''}`} aria-hidden="true" />
              <SplitSideCells side={row.left} which="old" lang={lang} oldHl={oldHl} newHl={newHl} />
              <SplitSideCells side={row.right} which="new" lang={lang} oldHl={oldHl} newHl={newHl} />
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}

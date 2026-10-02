import type { DiffRow } from '../../lib/diffRows';
import type { SymbolMark } from '../../lib/diffPresentation';
import { lineHtml, markFor, wordSegmentsForRows } from '../../lib/diffPresentation';
import type { HlLang } from '../../lib/highlight';
import { BoundaryRow } from './BoundaryRow';
import { DiffCode } from './DiffCode';
import { GapCell } from './GapCell';

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
  label: string;
}

const SIGN = { add: '+', del: '−', context: ' ' } as const;

export function UnifiedTable({ rows, lang, oldHl, newHl, oldMap, newMap, selectedSymbolId, onSelectSymbol, onExpand, label }: DiffTableProps) {
  const segments = wordSegmentsForRows(rows);
  let prevMark: string | undefined;

  return (
    <table className="dt dt--unified" aria-label={label}>
      <colgroup>
        <col className="dt__c-rail" />
        <col className="dt__c-no" />
        <col className="dt__c-no" />
        <col className="dt__c-sign" />
        <col />
      </colgroup>
      <tbody>
        {rows.map((row, i) => {
          if (row.kind === 'gap') {
            prevMark = undefined;
            return <GapCell key={`gap-${row.id}`} gap={row} colSpan={5} onExpand={onExpand} />;
          }
          const { line } = row;
          const mark = oldMap && newMap ? markFor(line, oldMap, newMap) : undefined;
          const boundary = mark && mark.id !== prevMark ? mark : undefined;
          prevMark = mark?.id;
          const key = `${line.type}-${line.oldNo ?? ''}-${line.newNo ?? ''}-${i}`;
          return [
            boundary && <BoundaryRow key={`b-${key}`} mark={boundary} colSpan={5} selected={boundary.id === selectedSymbolId} onSelect={onSelectSymbol} />,
            <tr
              key={key}
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
                <DiffCode line={line} lang={lang} segments={segments.get(i)} html={lineHtml(line, oldHl, newHl)} />
              </td>
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}

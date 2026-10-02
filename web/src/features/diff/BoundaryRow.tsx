import { StatusGlyph } from '../../components/StatusGlyph';
import type { SymbolMark } from '../../lib/diffPresentation';
import { STATUS_META } from '../../lib/labels';

interface BoundaryRowProps {
  mark: SymbolMark;
  colSpan: number;
  selected: boolean;
  onSelect?: (id: string) => void;
}

/** Diff içinde üye sınırı: hangi satırların hangi üyeye ait olduğunu gösterir; tıklayınca üyeyi seçer. */
export function BoundaryRow({ mark, colSpan, selected, onSelect }: BoundaryRowProps) {
  return (
    <tr className={`dl-boundary st-line--${mark.status}${selected ? ' is-selected' : ''}`}>
      <td colSpan={colSpan}>
        <button type="button" className="dl-boundary__btn" onClick={() => onSelect?.(mark.id)} disabled={!onSelect} title={`${mark.name} — ${STATUS_META[mark.status].label}. Denetçide aç`}>
          <StatusGlyph status={mark.status} size="sm" />
          <span className="dl-boundary__name">{mark.name}</span>
          <span className="dl-boundary__status">{STATUS_META[mark.status].label}</span>
        </button>
      </td>
    </tr>
  );
}

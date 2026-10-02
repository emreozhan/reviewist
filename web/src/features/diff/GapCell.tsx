import type { GapRow } from '../../lib/diffRows';

interface GapCellProps {
  gap: GapRow;
  colSpan: number;
  /** Pencereleme için öğe indeksi. */
  vi?: number;
  onExpand?: (id: string) => void;
}

/** Hunk arası değişmeyen satırlar: içerik varsa açılabilir ("bağlamı genişlet"). */
export function GapCell({ gap, colSpan, onExpand, vi }: GapCellProps) {
  const label = gap.count === null ? 'gizli satırlar' : `${gap.count} değişmeyen satır`;
  return (
    <tr className="dl-gap" data-vi={vi}>
      <td colSpan={colSpan}>
        {gap.expandable && onExpand ? (
          <button type="button" className="dl-gap__btn" onClick={() => onExpand(gap.id)} title="Bağlamı genişlet">
            <span aria-hidden="true">↕</span> {label} — göster
          </button>
        ) : (
          <span className="dl-gap__static">
            <span aria-hidden="true">⋯</span> {label}
            {!gap.expandable && gap.count !== 0 && onExpand && ' (tam içerik alınamadı)'}
          </span>
        )}
      </td>
    </tr>
  );
}

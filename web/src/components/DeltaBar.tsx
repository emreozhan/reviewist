interface DeltaBarProps {
  additions: number;
  deletions: number;
  /** Sayıları da göster. */
  showNumbers?: boolean;
}

const BLOCKS = 5;

/** Eklenen/silinen satır oranını 5 bloklu mini çubukla gösterir. */
export function DeltaBar({ additions, deletions, showNumbers = true }: DeltaBarProps) {
  const total = additions + deletions;
  const scale = Math.min(BLOCKS, Math.max(1, Math.ceil(Math.log2(total + 1))));
  const addBlocks = total === 0 ? 0 : Math.round((additions / total) * scale);
  const delBlocks = total === 0 ? 0 : scale - addBlocks;
  const label = `${additions} satır eklendi, ${deletions} satır silindi`;
  return (
    <span className="delta" title={label}>
      <span className="sr-only">{label}</span>
      {showNumbers && (
        <span className="delta__nums" aria-hidden="true">
          <span className="delta__add">+{additions}</span>
          <span className="delta__del">−{deletions}</span>
        </span>
      )}
      <span className="delta__bar" aria-hidden="true">
        {Array.from({ length: BLOCKS }, (_, i) => {
          const cls = i < addBlocks ? 'is-add' : i < addBlocks + delBlocks ? 'is-del' : '';
          return <span key={i} className={`delta__block ${cls}`} />;
        })}
      </span>
    </span>
  );
}

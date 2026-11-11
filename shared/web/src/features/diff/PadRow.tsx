interface PadRowProps {
  height: number;
  colSpan: number;
}

/** Pencerelemede çizilmeyen satırların yerini tutan boş satır. */
export function PadRow({ height, colSpan }: PadRowProps) {
  if (height <= 0) return null;
  return (
    <tr className="dt__pad" aria-hidden="true" style={{ height }}>
      <td colSpan={colSpan} />
    </tr>
  );
}

/** Değişken yükseklikli satır listesi için pencereleme (sanallaştırma) hesapları. DOM'dan bağımsızdır. */

/** offsets[i] = i. öğenin üst kenarı; offsets[n] = toplam yükseklik. */
export function prefixOffsets(heights: readonly number[]): Float64Array {
  const out = new Float64Array(heights.length + 1);
  for (let i = 0; i < heights.length; i++) out[i + 1] = (out[i] ?? 0) + (heights[i] ?? 0);
  return out;
}

/** `y` konumunu içeren öğenin indeksi (0..n-1 aralığına kıstırılır; boş listede 0). */
export function indexAtOffset(offsets: Float64Array, y: number): number {
  const n = offsets.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] ?? 0) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface WindowRange {
  /** İlk çizilecek öğe (dahil). */
  start: number;
  /** Son çizilecek öğenin bir fazlası (hariç). */
  end: number;
}

/** Görünür alan [viewTop, viewBottom] ve her iki yanda `overscan` piksellik pay için çizilecek aralık. */
export function windowRange(offsets: Float64Array, viewTop: number, viewBottom: number, overscan: number): WindowRange {
  const n = offsets.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  const start = indexAtOffset(offsets, Math.max(0, viewTop - overscan));
  const last = indexAtOffset(offsets, Math.max(0, viewBottom + overscan));
  return { start, end: Math.min(n, last + 1) };
}

/** Öğenin görünür alanın ortasına gelmesi için kaydırma konumu (liste başına göre). */
export function centeredOffset(offsets: Float64Array, index: number, viewportHeight: number): number {
  const top = offsets[index] ?? 0;
  const bottom = offsets[index + 1] ?? top;
  return Math.max(0, top + (bottom - top) / 2 - viewportHeight / 2);
}

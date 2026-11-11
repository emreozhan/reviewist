/**
 * Listede yazarak ada atlama: büyük/küçük harf duyarsız (Türkçe), önek eşleşmesi.
 * Tek karakter (ya da aynı karakterin tekrarı: "sss") o harfle başlayan bir sonraki öğeye döner;
 * daha uzun sorgu geçerli öğeden başlar (yazmaya devam etmek seçimi korur). Eşleşme yoksa -1.
 * Karşılaştırma NFC biçiminde yapılır (macOS'un ayrışık/NFD dosya adları da eşleşir).
 */
export function typeAheadIndex(labels: readonly string[], query: string, current: number): number {
  const n = labels.length;
  let q = query.normalize('NFC').toLocaleLowerCase('tr');
  if (n === 0 || q === '') return -1;
  const repeated = q.length > 1 && [...q].every((ch) => ch === q[0]);
  if (repeated) q = q[0] ?? q;
  const cycle = q.length === 1;
  const from = cycle ? current + 1 : Math.max(current, 0);
  for (let i = 0; i < n; i++) {
    const idx = (((from + i) % n) + n) % n;
    if ((labels[idx] ?? '').normalize('NFC').toLocaleLowerCase('tr').startsWith(q)) return idx;
  }
  return -1;
}

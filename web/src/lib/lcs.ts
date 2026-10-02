/** İki dizi arasında en uzun ortak alt dizi (LCS) tabanlı düzenleme listesi. */
export type EditOp =
  | { type: 'eq'; a: number; b: number }
  | { type: 'del'; a: number }
  | { type: 'add'; b: number };

/** n*m bu sınırı aşarsa LCS yerine kaba "hepsi silindi / hepsi eklendi" sonucu döner. */
const MAX_CELLS = 4_000_000;

export function diffSequences<T>(
  a: readonly T[],
  b: readonly T[],
  eq: (x: T, y: T) => boolean = Object.is,
): EditOp[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && eq(a[pre] as T, b[pre] as T)) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    eq(a[a.length - 1 - suf] as T, b[b.length - 1 - suf] as T)
  ) {
    suf++;
  }
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  const ops: EditOp[] = [];
  for (let i = 0; i < pre; i++) ops.push({ type: 'eq', a: i, b: i });

  if (n * m > MAX_CELLS) {
    for (let i = 0; i < n; i++) ops.push({ type: 'del', a: pre + i });
    for (let j = 0; j < m; j++) ops.push({ type: 'add', b: pre + j });
  } else {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = eq(a[pre + i] as T, b[pre + j] as T)
          ? (dp[(i + 1) * w + j + 1] ?? 0) + 1
          : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && eq(a[pre + i] as T, b[pre + j] as T)) {
        ops.push({ type: 'eq', a: pre + i, b: pre + j });
        i++;
        j++;
      } else if (i < n && (j === m || (dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + j + 1] ?? 0))) {
        ops.push({ type: 'del', a: pre + i });
        i++;
      } else {
        ops.push({ type: 'add', b: pre + j });
        j++;
      }
    }
  }

  for (let k = 0; k < suf; k++) {
    ops.push({ type: 'eq', a: a.length - suf + k, b: b.length - suf + k });
  }
  return ops;
}

/** Metni satırlara böler; sondaki tek yeni satır boş satır üretmez. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

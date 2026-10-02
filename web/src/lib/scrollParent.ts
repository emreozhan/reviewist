/**
 * Dikey kaydıran en yakın üst öğe. Yalnız yatay kaydıran kaplar (ör. `.code-surface`: overflow-x auto, bu yüzden
 * overflow-y de 'auto' hesaplanır) içerik taşmadığı için atlanır.
 */
export function scrollParent(el: HTMLElement): HTMLElement {
  let cur = el.parentElement;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight + 1) return cur;
    cur = cur.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

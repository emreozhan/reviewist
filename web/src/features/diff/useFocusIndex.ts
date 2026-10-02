import { useEffect, useMemo } from 'react';
import type { SplitItem, UnifiedItem } from '../../lib/diffItems';
import { indexOfNewLine } from '../../lib/diffItems';

export interface FocusRequest {
  line: number;
  tick: number;
}

/** Odak isteğini (yeni taraf satır no) öğe indeksine çevirir; satır tabloda yoksa `onMissing` çağrılır. */
export function useFocusIndex(
  items: readonly (UnifiedItem | SplitItem)[],
  focus: FocusRequest | null | undefined,
  onMissing?: () => void,
): { index: number; tick: number } | null {
  const index = useMemo(() => (focus ? indexOfNewLine(items, focus.line) : -1), [items, focus]);
  useEffect(() => {
    if (focus && index < 0) onMissing?.();
  }, [focus, index, onMissing]);
  return useMemo(() => (focus && index >= 0 ? { index, tick: focus.tick } : null), [focus, index]);
}

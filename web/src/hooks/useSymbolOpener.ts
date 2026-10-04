import { useCallback, useContext } from 'react';
import { PeekFromContext } from '../features/peek/PeekContext';
import type { OpenIntent } from '../lib/openIntent';
import type { NavHint } from './useCodeNav';
import { useCodeNav } from './useCodeNav';

export interface OpenerOpts {
  hint?: NavHint;
  origin?: { x: number; y: number };
  returnFocus?: HTMLElement | null;
}

/**
 * Sembol bağlantılarının ortak açıcısı: niyete göre gözatma penceresi / arka plan sekmesi / öne gelen sekme.
 * Gözatma penceresi, bağlantının bulunduğu yere (PeekFromContext) göre yığına eklenir.
 */
export function useSymbolOpener() {
  const nav = useCodeNav();
  const from = useContext(PeekFromContext);
  return useCallback(
    (symbolId: string, intent: OpenIntent, opts: OpenerOpts = {}) => nav.openByIntent(symbolId, intent, { ...opts, from }),
    [nav, from],
  );
}

import { useMemo, useSyncExternalStore } from 'react';
import type { Route } from '../lib/route';
import { parseHash } from '../lib/route';

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

const getHash = () => window.location.hash;

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getHash);
  return useMemo(() => parseHash(hash), [hash]);
}

import { useMemo, useSyncExternalStore } from 'react';
import type { Route } from '../lib/route';
import { parseHash, ROUTE_EVENT } from '../lib/route';

/** hashchange: kullanıcı/bağlantı; popstate: geri/ileri; ROUTE_EVENT: uygulamanın kendi pushState/replaceState'i. */
const EVENTS = ['hashchange', 'popstate', ROUTE_EVENT] as const;

function subscribe(cb: () => void): () => void {
  for (const e of EVENTS) window.addEventListener(e, cb);
  return () => {
    for (const e of EVENTS) window.removeEventListener(e, cb);
  };
}

const getHash = () => window.location.hash;

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getHash);
  return useMemo(() => parseHash(hash), [hash]);
}

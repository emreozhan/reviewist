/** Basit hash yönlendirmesi: #/ , #/review/:id/:tab?file=..&sym=..&view=..&layout=.. */
export type Tab = 'workspace' | 'graph' | 'findings';

export interface RouteParams {
  file?: string;
  sym?: string;
  view?: 'structure' | 'diff';
  layout?: 'unified' | 'split';
  line?: number;
}

export type Route = { name: 'home' } | { name: 'review'; id: string; tab: Tab; params: RouteParams };

const TABS: readonly Tab[] = ['workspace', 'graph', 'findings'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (segs[0] !== 'review' || !segs[1]) return { name: 'home' };
  const tabSeg = segs[2] as Tab | undefined;
  const tab: Tab = tabSeg && TABS.includes(tabSeg) ? tabSeg : 'workspace';
  const q = new URLSearchParams(queryPart);
  const params: RouteParams = {};
  const file = q.get('file');
  if (file) params.file = file;
  const sym = q.get('sym');
  if (sym) params.sym = sym;
  const view = q.get('view');
  if (view === 'structure' || view === 'diff') params.view = view;
  const layout = q.get('layout');
  if (layout === 'unified' || layout === 'split') params.layout = layout;
  const line = Number(q.get('line'));
  if (Number.isInteger(line) && line > 0) params.line = line;
  return { name: 'review', id: segs[1], tab, params };
}

export function formatHash(route: Route): string {
  if (route.name === 'home') return '#/';
  const q = new URLSearchParams();
  const p = route.params;
  if (p.file) q.set('file', p.file);
  if (p.sym) q.set('sym', p.sym);
  if (p.view) q.set('view', p.view);
  if (p.layout) q.set('layout', p.layout);
  if (p.line) q.set('line', String(p.line));
  const qs = q.toString();
  return `#/review/${encodeURIComponent(route.id)}/${route.tab}${qs ? `?${qs}` : ''}`;
}

export function navigate(route: Route, replace = false): void {
  const hash = formatHash(route);
  if (window.location.hash === hash) return;
  if (replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

/** Hash'i olay tetiklemeden günceller (seçim değişince adres çubuğunu senkron tutmak için). */
export function replaceHashSilently(route: Route): void {
  const hash = formatHash(route);
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
}

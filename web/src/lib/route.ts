/**
 * Basit hash yönlendirmesi: #/ , #/review/:id/:tab?file=..&sym=..&view=..&layout=..
 * Diff dışı (Kaynak görünümlü) etkin sekme: ?src=<yol>&sym=..[&side=old]. Adres yalnız etkin sekmeyi tutar.
 */
export type Tab = 'workspace' | 'graph' | 'findings';

export interface RouteParams {
  file?: string;
  sym?: string;
  view?: 'structure' | 'diff';
  layout?: 'unified' | 'split';
  line?: number;
  /** Diff dışı dosyanın yolu (salt okunur Kaynak sekmesi). */
  src?: string;
  /** Kaynak sekmesinin tarafı (silinmiş sembolde 'old'). */
  side?: 'old';
}

export type Route = { name: 'home' } | { name: 'review'; id: string; tab: Tab; params: RouteParams };

const TABS: readonly Tab[] = ['workspace', 'graph', 'findings'];

/** Bozuk `%` dizisi (ör. `%E0%A4%A`) içeren parça için fırlatmaz: çözülemezse ham metin döner. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Adres çubuğundan gelen hash'i ayrıştırır; hiçbir girdi için fırlatmaz (render sırasında çağrılır). */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map(safeDecode);
  if (segs[0] !== 'review' || !segs[1]) return { name: 'home' };
  const tabSeg = segs[2] as Tab | undefined;
  const tab: Tab = tabSeg && TABS.includes(tabSeg) ? tabSeg : 'workspace';
  // URLSearchParams bozuk `%` dizilerinde fırlatmaz (olduğu gibi bırakır).
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
  const src = q.get('src');
  if (src) params.src = src;
  if (q.get('side') === 'old') params.side = 'old';
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
  if (p.src) q.set('src', p.src);
  if (p.side) q.set('side', p.side);
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

/** pushState/replaceState `hashchange` tetiklemez; useHashRoute bu olayla haberdar edilir. */
export const ROUTE_EVENT = 'reviewist:route';

/**
 * Seçimi adrese yazar. `push`: yeni geçmiş kaydı (geri/ileri ile dönülebilir); değilse mevcut kaydı değiştirir.
 * Yazılan hash'i döndürür (değişiklik yoksa null).
 */
export function writeHash(route: Route, push: boolean): string | null {
  const hash = formatHash(route);
  if (window.location.hash === hash) return null;
  if (push) window.history.pushState(null, '', hash);
  else window.history.replaceState(null, '', hash);
  window.dispatchEvent(new Event(ROUTE_EVENT));
  return hash;
}

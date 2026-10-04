import type { FsEntry, FsListing, FsRoot } from '../../../src/shared/types';
import { ApiRequestError } from '../lib/apiTypes';
import { pathKey } from '../lib/fsPath';

/**
 * Mock modu (`?mock=1`) için sahte Windows dizin ağacı. `git` işaretli klasörler depo köküdür;
 * `deny` erişim hatası (403) verir. Ad sırası sunucudaki gibi Türkçe yerel duyarlıdır.
 */
interface Node {
  git?: boolean;
  deny?: boolean;
  children?: Record<string, Node>;
}

const javaRepo = (extra: Record<string, Node> = {}): Node => ({
  git: true,
  children: {
    '.git': {},
    '.idea': {},
    src: { children: { main: { children: { java: { children: { com: { children: { acme: {} } } } }, resources: {} } }, test: { children: { java: {} } } } },
    docs: {},
    gradle: { children: { wrapper: {} } },
    ...extra,
  },
});

/** Pencereleme denemesi için çok modüllü depo. */
const manyModules: Record<string, Node> = Object.fromEntries(
  Array.from({ length: 420 }, (_, i) => [`modül-${String(i + 1).padStart(3, '0')}`, { children: { src: {} } }]),
);

const TREE: Record<string, Node> = {
  'C:\\': {
    children: {
      '$Recycle.Bin': { deny: true },
      'System Volume Information': { deny: true },
      ProgramData: {},
      'Program Files': { children: { Git: {}, nodejs: {} } },
      Windows: { deny: true },
      Users: {
        children: {
          demo: {
            children: {
              '.config': {},
              '.m2': { children: { repository: {} } },
              AppData: {},
              Belgeler: { children: { Notlar: {}, Sunumlar: {} } },
              Desktop: {},
              Downloads: { children: { 'guava-33.0': { children: { guava: {} } } } },
              projeler: {
                children: {
                  'ödeme-servisi': javaRepo(),
                  'legacy-monolith': javaRepo({ modules: { children: manyModules } }),
                  'çalışma-notları': {},
                  'ui-kit': { git: true, children: { '.git': {}, packages: {} } },
                  arşiv: { children: { 'eski-shop': javaRepo() } },
                },
              },
            },
          },
        },
      },
      work: {
        children: {
          shop: javaRepo({ 'shop-admin': { children: { src: {} } } }),
          billing: javaRepo(),
          sandbox: {},
          Ünite: {},
        },
      },
    },
  },
  'D:\\': { children: { yedek: { children: { 'shop-2024': javaRepo() } }, ISO: {} } },
};

const HOME = 'C:\\Users\\demo';
const HIDDEN = new Set(['$recycle.bin', 'system volume information', 'programdata', 'appdata']);
const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });

const isHidden = (name: string): boolean => name.startsWith('.') || HIDDEN.has(name.toLowerCase());

/** Yolu düğüme çözer; büyük/küçük harf duyarsız. */
function resolveNode(path: string): { node: Node; path: string } | undefined {
  const key = pathKey(path);
  const drive = Object.keys(TREE).find((d) => key.startsWith(pathKey(d)));
  if (!drive) return undefined;
  let node: Node | undefined = TREE[drive];
  let real = drive.slice(0, -1);
  const rest = key.slice(pathKey(drive).length).split('\\').filter(Boolean);
  for (const seg of rest) {
    const name: string | undefined = Object.keys(node?.children ?? {}).find((n) => n.toLowerCase() === seg);
    if (!node || name === undefined) return undefined;
    node = node.children?.[name];
    real = `${real}\\${name}`;
  }
  return node ? { node, path: real || drive } : undefined;
}

function roots(): FsRoot[] {
  return [
    { label: 'Ev', path: HOME, kind: 'home' },
    { label: 'Masaüstü', path: `${HOME}\\Desktop`, kind: 'special' },
    { label: 'Belgeler', path: `${HOME}\\Belgeler`, kind: 'special' },
    { label: 'İndirilenler', path: `${HOME}\\Downloads`, kind: 'special' },
    { label: 'Çalışma dizini', path: 'C:\\work\\shop', kind: 'cwd' },
    { label: 'C:', path: 'C:\\', kind: 'drive' },
    { label: 'D:', path: 'D:\\', kind: 'drive' },
  ];
}

function fail(status: number, message: string, path: string): never {
  throw new ApiRequestError(message, { kind: 'http', status, endpoint: `mock:/api/fs/list?path=${path}`, field: 'path', fromServerBody: true });
}

export function mockListFs(rawPath: string, hidden: boolean): FsListing {
  const trimmed = rawPath.trim() === '' ? HOME : rawPath.trim().replace(/\//g, '\\');
  const raw = /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
  if (!/^[A-Za-z]:(\\|$)/.test(raw)) fail(400, `Yol mutlak olmalı: ${raw}`, raw);
  const found = resolveNode(raw);
  if (!found) fail(404, `Klasör bulunamadı: ${raw}`, raw);
  const { node, path } = found;
  if (node.deny) fail(403, `Bu klasöre erişim izni yok: ${path}`, path);
  const isRoot = /^[A-Za-z]:\\?$/.test(path);
  const display = isRoot ? `${path.slice(0, 2)}\\` : path;
  const entries: FsEntry[] = Object.entries(node.children ?? {})
    .filter(([name]) => hidden || !isHidden(name))
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([name, child]) => ({ name, path: `${display.replace(/\\$/, '')}\\${name}`, isGitRepo: !!child.git, hidden: isHidden(name) }));
  const listing: FsListing = { path: display, isGitRepo: !!node.git, entries, roots: roots(), truncated: false };
  if (!isRoot) {
    const up = display.slice(0, display.lastIndexOf('\\'));
    listing.parent = /^[A-Za-z]:$/.test(up) ? `${up}\\` : up;
  }
  if (!node.git) {
    // En yakın üst depo.
    let cur = listing.parent;
    while (cur) {
      const r = resolveNode(cur);
      if (r?.node.git) {
        listing.repoRoot = r.path;
        break;
      }
      const up = cur.slice(0, cur.lastIndexOf('\\'));
      cur = up.length >= 2 && !/^[A-Za-z]:\\$/.test(cur) ? (/^[A-Za-z]:$/.test(up) ? `${up}\\` : up) : undefined;
    }
  }
  return listing;
}

import { useEffect, useMemo, useState } from 'react';
import type { FsEntry, FsListing, FsRoot } from '../../../../../src/shared/types';
import { useFsList } from '../../../hooks/queries';
import { isWindowsPath, pathCrumbs, pathKey } from '../../../lib/fsPath';

/** Listedeki satır: üst klasör (`..`) ya da alt klasör. */
export type FolderRow = { kind: 'up'; key: string; path: string; label: '..' } | { kind: 'dir'; key: string; path: string; label: string; entry: FsEntry };

/** Oturum içinde son gezilen klasör (pencere yeniden açılınca buradan başlar). */
let lastVisited: string | undefined;

const isAbsolute = (p: string): boolean => isWindowsPath(p) || p.startsWith('/');

/** Başlangıç: alanda mutlak bir yol varsa üst klasörü (o klasör seçili), yoksa son gezilen ya da ev dizini. */
function initialState(value: string): { path: string; selected: string | null } {
  const v = value.trim();
  if (v && isAbsolute(v)) {
    const crumbs = pathCrumbs(v);
    const parent = crumbs[crumbs.length - 2];
    if (parent) return { path: parent.path, selected: pathKey(v) };
    return { path: v, selected: null };
  }
  return { path: lastVisited ?? '', selected: null };
}

export function rowsOf(listing: FsListing | undefined): FolderRow[] {
  if (!listing) return [];
  const rows: FolderRow[] = [];
  if (listing.parent) rows.push({ kind: 'up', key: `..:${pathKey(listing.parent)}`, path: listing.parent, label: '..' });
  for (const entry of listing.entries) rows.push({ kind: 'dir', key: pathKey(entry.path), path: entry.path, label: entry.name, entry });
  return rows;
}

export function useFolderBrowser(initialValue: string) {
  const [start] = useState(() => initialState(initialValue));
  const [path, setPath] = useState(start.path);
  const [selectedKey, setSelectedKey] = useState<string | null>(start.selected);
  const [hidden, setHidden] = useState(false);
  const query = useFsList(path, hidden);
  // Yeni yol yüklenirken eski liste gösterilir (titreme olmaz) ama etkileşim yeni yola göre yapılır.
  const listing = query.isPlaceholderData ? undefined : query.data;
  const shown = query.data;
  const rows = useMemo(() => rowsOf(shown), [shown]);
  const selectedIndex = selectedKey === null ? -1 : rows.findIndex((r) => r.key === selectedKey);
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : undefined;

  // Kısayollar son başarılı listeden gelir (hata durumunda da kenar çubuğu kullanılabilir kalır).
  const [roots, setRoots] = useState<FsRoot[]>([]);
  useEffect(() => {
    if (!listing) return;
    lastVisited = listing.path;
    setRoots(listing.roots);
  }, [listing]);

  /** `focusPath` verilirse yeni listede o klasör seçili gelir (üst klasöre çıkınca gelinen klasör). */
  const navigate = (next: string, focusPath?: string) => {
    setPath(next.trim());
    setSelectedKey(focusPath ? pathKey(focusPath) : null);
  };
  const goUp = () => {
    if (listing?.parent) navigate(listing.parent, listing.path);
  };
  const open = (row: FolderRow | undefined) => {
    if (!row) return;
    if (row.kind === 'up') goUp();
    else navigate(row.path);
  };
  const selectIndex = (i: number) => {
    const row = rows[i];
    if (row) setSelectedKey(row.key);
  };

  return {
    path,
    hidden,
    setHidden,
    query,
    roots,
    listing,
    shown,
    rows,
    selectedIndex,
    selectedRow,
    selectedEntry: selectedRow?.kind === 'dir' ? selectedRow.entry : undefined,
    navigate,
    goUp,
    open,
    selectIndex,
  };
}

export type FolderBrowser = ReturnType<typeof useFolderBrowser>;

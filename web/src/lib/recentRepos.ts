import type { ReviewRequest } from '../../../src/shared/types';
import { pathKey } from './fsPath';
import type { KeyValueStorage } from './persistence';

/** Başarılı analizlerin repo yolları (klasör seçicide "Son kullanılan repolar"). */
export const RECENT_REPOS_KEY = 'reviewist:recentRepos';
export const MAX_RECENT_REPOS = 8;

/** Yolu başa ekler; aynı yol (Windows'ta harf/ayırıcı duyarsız) tekrar edilmez, en çok `max` kayıt. */
export function pushRecentRepo(list: readonly string[], path: string, max = MAX_RECENT_REPOS): string[] {
  const p = path.trim();
  if (p === '') return list.slice(0, max);
  const key = pathKey(p);
  return [p, ...list.filter((x) => pathKey(x) !== key)].slice(0, max);
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (error) {
    console.warn('localStorage erişilemiyor', error);
    return null;
  }
}

export function loadRecentRepos(storage: KeyValueStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_REPOS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Bozuk/eski kayıtlar ayıklanır; tekrar ve fazlalık da temizlenir.
    return parsed.filter((x): x is string => typeof x === 'string').reduceRight<string[]>((acc, p) => pushRecentRepo(acc, p), []);
  } catch (error) {
    console.warn('Son kullanılan repolar okunamadı', error);
    return [];
  }
}

/** Yolu kaydeder ve yeni listeyi döndürür (depolama yoksa/hata olursa yalnız hesaplanır). */
export function rememberRepo(path: string, storage: KeyValueStorage | null = defaultStorage()): string[] {
  const next = pushRecentRepo(loadRecentRepos(storage), path);
  if (!storage) return next;
  try {
    storage.setItem(RECENT_REPOS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Son kullanılan repolar kaydedilemedi', error);
  }
  return next;
}

/** İstekteki yerel depo yolu (yoksa undefined). */
export function repoPathOf(req: ReviewRequest): string | undefined {
  switch (req.kind) {
    case 'git':
    case 'worktree':
      return req.repoPath;
    case 'github':
      return req.localRepoPath;
    case 'patch':
      return req.repoPath;
  }
}

import type { KeyValueStorage } from './persistence';

/**
 * İnceleme kimliği → o incelemenin tarayıcıdaki kayıt anahtarları (görüldü/not ve sekmeler). Sunucunun liste
 * yanıtı `stableKey` taşımadığından, inceleme açıldığında burada not edilir; silinirken bu anahtarlar temizlenir.
 */
export const REVIEW_KEYS_KEY = 'reviewist:reviewKeys';
const MAX_ENTRIES = 200;

export interface ReviewStorageKeys {
  /** Görüldü işaretleri ve notlar (`reviewist:{stableKey}`). */
  progress: string;
  /** Sekmeler (`reviewist:tabs:{stableKey}`). */
  tabs: string;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (error) {
    console.warn('localStorage erişilemiyor', error);
    return null;
  }
}

function isKeys(v: unknown): v is ReviewStorageKeys {
  return typeof v === 'object' && v !== null && typeof (v as ReviewStorageKeys).progress === 'string' && typeof (v as ReviewStorageKeys).tabs === 'string';
}

/** Yalnız uygulamanın inceleme kayıtları silinebilir (düzen ve son depolar gibi genel kayıtlar asla). */
function isReviewStateKey(key: string): boolean {
  return key.startsWith('reviewist:') && key !== REVIEW_KEYS_KEY && key !== 'reviewist:layout' && key !== 'reviewist:recentRepos';
}

function loadMap(storage: KeyValueStorage): Record<string, ReviewStorageKeys> {
  try {
    const raw = storage.getItem(REVIEW_KEYS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, ReviewStorageKeys] => isKeys(e[1])));
  } catch (error) {
    console.warn('İnceleme anahtarları okunamadı', error);
    return {};
  }
}

function saveMap(storage: KeyValueStorage, map: Record<string, ReviewStorageKeys>): void {
  try {
    const entries = Object.entries(map).slice(-MAX_ENTRIES);
    storage.setItem(REVIEW_KEYS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (error) {
    console.warn('İnceleme anahtarları kaydedilemedi', error);
  }
}

export function rememberReviewKeys(id: string, keys: ReviewStorageKeys, storage: KeyValueStorage | null = defaultStorage()): void {
  if (!storage) return;
  const map = loadMap(storage);
  const cur = map[id];
  if (cur && cur.progress === keys.progress && cur.tabs === keys.tabs) return;
  delete map[id];
  map[id] = keys;
  saveMap(storage, map);
}

/**
 * Silinen incelemenin kayıtlarını temizler: `known` (önbellekteki modelden) ya da açılışta not edilen anahtarlar.
 * Silinen anahtarları döndürür.
 */
export function forgetReviewState(id: string, known?: ReviewStorageKeys, storage: KeyValueStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  const map = loadMap(storage);
  const removed: string[] = [];
  for (const keys of [known, map[id]]) {
    if (!keys) continue;
    for (const k of [keys.progress, keys.tabs]) {
      if (!isReviewStateKey(k) || removed.includes(k)) continue;
      try {
        storage.removeItem?.(k);
        removed.push(k);
      } catch (error) {
        console.warn('İnceleme kaydı silinemedi', error);
      }
    }
  }
  if (map[id]) {
    delete map[id];
    saveMap(storage, map);
  }
  return removed;
}

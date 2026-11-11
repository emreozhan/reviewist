import type { KeyValueStorage } from './persistence';

/** GitHub sürümü: başarılı analizlerin PR/depo adresleri ("Son adresler"). Kimlik bilgisi taşıyan adres kaydedilmez. */
export const RECENT_URLS_KEY = 'reviewist:recentUrls';
export const MAX_RECENT_URLS = 8;

/** Sorgu dizgisinde kimlik bilgisi taşıyabilecek parametre adları. */
const SECRET_PARAM = /token|secret|password|passwd|auth|key|sig/i;

/**
 * Adres kalıcı olarak saklanabilir mi: http(s) adresinde kullanıcı adı/parola ya da token benzeri sorgu parametresi,
 * diğer şemalarda parola varsa saklanmaz. (`git@host:…` biçimindeki `git` kullanıcısı kimlik bilgisi değildir.)
 */
export function isSafeToRemember(url: string): boolean {
  const u = url.trim();
  if (u === '' || u.length > 500 || /\s/.test(u)) return false;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return true; // sahip/depo#12, git@github.com:sahip/depo.git
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  if (parsed.password) return false;
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    if (parsed.username) return false;
    for (const name of parsed.searchParams.keys()) if (SECRET_PARAM.test(name)) return false;
  }
  return true;
}

const keyOf = (url: string) => url.trim().toLowerCase();

/** Adresi başa ekler; aynı adres (büyük/küçük harf duyarsız) tekrar edilmez, en çok `max` kayıt; güvensiz adres eklenmez. */
export function pushRecentUrl(list: readonly string[], url: string, max = MAX_RECENT_URLS): string[] {
  const u = url.trim();
  if (!isSafeToRemember(u)) return list.slice(0, max);
  const key = keyOf(u);
  return [u, ...list.filter((x) => keyOf(x) !== key)].slice(0, max);
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (error) {
    console.warn('localStorage erişilemiyor', error);
    return null;
  }
}

export function loadRecentUrls(storage: KeyValueStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_URLS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Bozuk, güvensiz ya da fazla kayıtlar ayıklanır.
    return parsed.filter((x): x is string => typeof x === 'string').reduceRight<string[]>((acc, u) => pushRecentUrl(acc, u), []);
  } catch (error) {
    console.warn('Son adresler okunamadı', error);
    return [];
  }
}

/** Adresi kaydeder ve yeni listeyi döndürür (güvensizse liste değişmez). */
export function rememberUrl(url: string, storage: KeyValueStorage | null = defaultStorage()): string[] {
  const before = loadRecentUrls(storage);
  if (!isSafeToRemember(url)) return before;
  const next = pushRecentUrl(before, url);
  if (!storage) return next;
  try {
    storage.setItem(RECENT_URLS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Son adresler kaydedilemedi', error);
  }
  return next;
}

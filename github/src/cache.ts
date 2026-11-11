/**
 * Klon önbelleği: her uzak depo `<önbellek>/repos/<sunucu>/<sahip>/<depo>` altında bir git deposu olarak tutulur ve
 * sonraki incelemelerde artımlı `git fetch` ile güncellenir. Aynı depoya eşzamanlı iki getirme olmasın diye süreç içi
 * bir kilit vardır.
 */
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { expandHome } from '../../shared/src/sources/common.js';
import type { RemoteSpec } from './remote.js';

export const CACHE_DIR_ENV = 'REVIEWIST_CACHE_DIR';
const APP_DIR = 'reviewist-github';

export interface CacheDirContext {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

/** Önbellek klasörü: `--cache-dir` → `REVIEWIST_CACHE_DIR` → platform varsayılanı. Her zaman mutlak yol. */
export function resolveCacheDir(explicit?: string, ctx: CacheDirContext = {}): string {
  const env = ctx.env ?? process.env;
  const platform = ctx.platform ?? process.platform;
  const home = ctx.home ?? homedir();
  const given = explicit?.trim() || env[CACHE_DIR_ENV]?.trim();
  if (given) return resolve(expandHome(given, home));
  if (platform === 'darwin') return join(home, 'Library', 'Caches', APP_DIR);
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA?.trim() || join(home, 'AppData', 'Local');
    return join(local, APP_DIR, 'cache');
  }
  const xdg = env.XDG_CACHE_HOME?.trim();
  // XDG: göreli değer geçersizdir, yok sayılır.
  return xdg && isAbsolute(xdg) ? join(xdg, APP_DIR) : join(home, '.cache', APP_DIR);
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/;

/**
 * Tek bir yol parçası: küçük harf, yalnız `[a-z0-9._-]`; nokta ile başlayamaz/bitemez (`.`/`..` ve Windows'un sondaki
 * noktayı atması), Windows ayrılmış adları önekli. Sonuç hiçbir zaman ayırıcı ya da üst klasör referansı içermez.
 */
export function safeSegment(s: string): string {
  let out = s.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  if (out.startsWith('.')) out = `_${out}`;
  if (out.endsWith('.')) out = `${out}_`;
  if (out === '') out = '_';
  if (WINDOWS_RESERVED.test(out)) out = `_${out}`;
  return out.slice(0, 100);
}

/** Uzak deponun önbellek klasörü: `<önbellek>/repos/<sunucu>/<sahip>/<depo>`. Önbellek dışına çıkamaz. */
export function repoDirFor(cacheDir: string, remote: Pick<RemoteSpec, 'host' | 'owner' | 'repo'>): string {
  const root = resolve(cacheDir, 'repos');
  const dir = resolve(root, safeSegment(remote.host), safeSegment(remote.owner), safeSegment(remote.repo));
  const rel = relative(root, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(/[\\/]/).length !== 3) {
    // safeSegment ile olanaksız; yine de savunma.
    throw new Error(`Önbellek yolu önbellek klasörünün dışına çıkıyor: ${dir}`);
  }
  return dir;
}

const locks = new Map<string, Promise<void>>();

function lockKey(dir: string): string {
  const p = resolve(dir);
  return process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
}

/** Aynı depo klasörü için işleri sırayla çalıştırır (süreç içi). Hata kilidi bozmaz. */
export async function withRepoLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(dir);
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const tail = prev.then(() => mine);
  locks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

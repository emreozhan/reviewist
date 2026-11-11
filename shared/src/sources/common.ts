/**
 * Kaynaklar arasında paylaşılan yardımcılar: yaşam döngülü ChangeSet tipi, LRU önbellek,
 * ikili içerik tespiti, eşzamanlılık sınırlayıcı, eski/yeni taraf yol eşlemesi.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ChangeSet, ChangeSetFile } from '../shared/types.js';

/** Kaynak katmanının döndürdüğü ChangeSet: uyarılar + kaynakları serbest bırakma. */
export interface ManagedChangeSet extends ChangeSet {
  /** Kaynak oluşturulurken ya da sonradan (ör. listFiles sırasında) eklenen Türkçe uyarılar. */
  warnings: string[];
  /**
   * Süreçleri/geçici dizinleri kapatır. Birden çok kez çağrılabilir. Promise dönerse kaynaklar
   * tamamen serbest kaldığında çözülür; çağıranın beklemesi zorunlu değildir.
   */
  dispose(): void | Promise<void>;
  /**
   * Analiz bittikten sonra çağrılır: yalnız analiz sırasında işe yarayan büyük önbellekleri bırakır.
   * Kaynak kullanılabilir kalır (sonraki okumalar yeniden yüklenir).
   */
  compact?(): void;
}

/** İlk 8000 baytta NUL varsa ikili sayılır (git'in sezgiseliyle aynı). */
export function isBinaryBuffer(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * NUL içerse de içerik incelemesiyle metin sayılabilecek kaynak uzantıları. Bu dosyalar git'in NUL
 * sezgiseliyle ikili sayılırsa repo indeksinden düşer (ör. commons-lang `ClassUtilsOssFuzzTest.java`:
 * dize sabitlerinde binlerce `\u0000`, geçerli UTF-8).
 */
const NUL_TOLERANT_EXTS = ['.java', '.kt', '.kts', '.groovy', '.scala'];

/** İlk 8000 baytta bu orandan fazla geçersiz UTF-8 dizisi varsa içerik ikilidir. */
const MAX_INVALID_UTF8_RATIO = 0.02;

/**
 * İçeriğin ikili olup olmadığına yola göre karar verir.
 * - İlk 8000 baytta NUL yoksa metin.
 * - NUL varsa ve uzantı Java/JVM kaynağı değilse ikili (git ile aynı).
 * - Java/JVM kaynağında yalnız gerçekten ikiliyse ikili: geçersiz UTF-8 oranı yüksek ya da UTF-16 düzeni
 *   (baytların %30'undan fazlası NUL ve neredeyse hepsi aynı çift/tek konumda).
 */
export function isBinaryContent(buf: Uint8Array, path: string | undefined): boolean {
  if (!isBinaryBuffer(buf)) return false;
  const lower = (path ?? '').toLowerCase();
  if (!NUL_TOLERANT_EXTS.some((e) => lower.endsWith(e))) return true;
  const head = buf.subarray(0, Math.min(buf.length, 8000));
  let nul = 0;
  let evenNul = 0;
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) {
      nul++;
      if (i % 2 === 0) evenNul++;
    }
  }
  if (nul > head.length * 0.3) {
    const dominant = Math.max(evenNul, nul - evenNul);
    if (dominant >= nul * 0.9) return true; // UTF-16 (LE/BE) kodlu metin: UTF-8 olarak okunamaz
  }
  return countInvalidUtf8(head) > head.length * MAX_INVALID_UTF8_RATIO;
}

/** Geçersiz UTF-8 dizisi sayısı; sondaki yarım kalmış çok baytlı dizi sayılmaz (8000 bayt kesimi). */
function countInvalidUtf8(b: Uint8Array): number {
  let bad = 0;
  let i = 0;
  while (i < b.length) {
    const c = b[i] ?? 0;
    if (c < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let min: number;
    if (c >= 0xc2 && c <= 0xdf) {
      need = 1;
      min = 0x80;
    } else if (c >= 0xe0 && c <= 0xef) {
      need = 2;
      min = 0x800;
    } else if (c >= 0xf0 && c <= 0xf4) {
      need = 3;
      min = 0x10000;
    } else {
      bad++;
      i++;
      continue;
    }
    if (i + need >= b.length) {
      // dizi tamponun sonunda kesilmiş olabilir: yalnız mevcut devam baytları geçerliyse sayma
      let ok = true;
      for (let k = i + 1; k < b.length; k++) if (((b[k] ?? 0) & 0xc0) !== 0x80) ok = false;
      if (!ok) bad++;
      break;
    }
    let cp = c & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
    let valid = true;
    for (let k = 1; k <= need; k++) {
      const cc = b[i + k] ?? 0;
      if ((cc & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      cp = (cp << 6) | (cc & 0x3f);
    }
    if (!valid || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      bad++;
      i++;
      continue;
    }
    i += need + 1;
  }
  return bad;
}

/** Boyut tabanlı LRU önbellek. */
export class LruCache<V> {
  private readonly map = new Map<string, { value: V; size: number }>();
  private total = 0;

  constructor(
    private readonly maxSize: number,
    private readonly sizeOf: (v: V) => number = () => 1,
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    const old = this.map.get(key);
    if (old) {
      this.total -= old.size;
      this.map.delete(key);
    }
    const size = Math.max(1, this.sizeOf(value));
    if (size > this.maxSize) return; // tek başına sığmayan değer önbelleğe alınmaz
    this.map.set(key, { value, size });
    this.total += size;
    while (this.total > this.maxSize) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      const e = this.map.get(oldest.value);
      this.map.delete(oldest.value);
      if (e) this.total -= e.size;
    }
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }

  get size(): number {
    return this.map.size;
  }
}

/** Basit eşzamanlılık sınırlayıcı (semafor). */
export function createLimiter(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = (): void => {
    const run = queue.shift();
    if (run) run(); // yuva doğrudan sıradakine devredilir (active değişmez)
    else active--;
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((r) => queue.push(r));
    else active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/** `\` → `/`, baştaki `./` ve `/` temizlenir. */
export function normalizeRepoPath(p: string): string {
  let out = p.replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  while (out.startsWith('/')) out = out.slice(1);
  return out;
}

/**
 * Depo köküne göre göreli yolu mutlak yola çevirir; kök dışına çıkıyorsa undefined (yol geçişi koruması).
 */
export function resolveInside(root: string, rel: string): string | undefined {
  const norm = normalizeRepoPath(rel);
  if (norm === '' || norm.includes('\0')) return undefined;
  const abs = resolve(root, norm);
  const r = relative(root, abs);
  if (r === '' || r.startsWith('..') || isAbsolute(r)) return undefined;
  return abs;
}

const realRootCache = new Map<string, Promise<string>>();

function realRootOf(root: string): Promise<string> {
  let p = realRootCache.get(root);
  if (!p) {
    p = realpath(root);
    p.catch(() => realRootCache.delete(root));
    realRootCache.set(root, p);
    if (realRootCache.size > 64) realRootCache.delete(realRootCache.keys().next().value as string);
  }
  return p;
}

/**
 * Depo içindeki bir dosyayı diskten okur; git'in gördüğü içerikle tutarlı ve depo dışına çıkmayacak şekilde:
 *  - Dosyanın kendisi sembolik bağ ise hedef izlenmez; bağın gösterdiği yol metni döner (git blob'u da budur).
 *  - Üst klasörlerden biri depo dışını gösteren bir bağ ise (ya da yol kök dışına çıkıyorsa) okunmaz.
 *  - Normal dosya olmayanlar (klasör, soket, aygıt) okunmaz.
 * Okunamayan her durumda undefined döner.
 */
export async function readRepoFile(root: string, rel: string): Promise<Buffer | undefined> {
  const abs = resolveInside(root, rel);
  if (!abs) return undefined;
  try {
    const st = await lstat(abs);
    if (st.isSymbolicLink()) return Buffer.from(await readlink(abs), 'utf8');
    if (!st.isFile()) return undefined;
    const [realRoot, realFile] = await Promise.all([realRootOf(root), realpath(abs)]);
    const r = relative(realRoot, realFile);
    if (r === '' || r.startsWith('..') || isAbsolute(r)) return undefined;
    return await readFile(abs);
  } catch {
    return undefined;
  }
}

/** Baştaki `~` (ev dizini) kısaltmasını açar: `~`, `~/x` (Windows'ta `~\x` de). Diğer yollar olduğu gibi döner. */
export function expandHome(p: string, home: string = homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return p;
}

/** İşletim sisteminin bıraktığı, incelemeye girmemesi gereken dosyalar (macOS Finder, AppleDouble, Windows küçük resimleri). */
export function isOsJunkFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name === '.DS_Store' || name.startsWith('._') || name === 'Thumbs.db' || name === 'desktop.ini';
}

export interface SideTarget {
  /** O tarafta okunacak yol; dosya o tarafta yoksa undefined. */
  path?: string;
  binary: boolean;
}

/**
 * ChangeSet dosya listesine göre `readFile(side, path)` çağrısını gerçek yola eşler.
 * - old: yeniden adlandırılan/kopyalanan dosyanın YENİ yolu verilirse eski yol okunur; eklenen dosyada yok.
 * - new: silinen dosyada yok; eski adı verilen (taşınmış) dosyada yok.
 */
export function createSideResolver(files: ChangeSetFile[]): (side: 'old' | 'new', p: string) => SideTarget {
  const byPath = new Map<string, ChangeSetFile>();
  const byOldPath = new Map<string, ChangeSetFile>();
  for (const f of files) {
    byPath.set(f.path, f);
    if (f.oldPath !== undefined) byOldPath.set(f.oldPath, f);
  }
  return (side, raw) => {
    const p = normalizeRepoPath(raw);
    if (side === 'old') {
      const asOld = byOldPath.get(p);
      if (asOld) return { path: p, binary: asOld.binary };
      const e = byPath.get(p);
      if (!e) return { path: p, binary: false };
      if (e.status === 'added') return { binary: e.binary };
      if ((e.status === 'renamed' || e.status === 'copied') && e.oldPath !== undefined) {
        return { path: e.oldPath, binary: e.binary };
      }
      return { path: p, binary: e.binary };
    }
    const e = byPath.get(p);
    if (e) {
      if (e.status === 'deleted') return { binary: e.binary };
      return { path: p, binary: e.binary };
    }
    const moved = byOldPath.get(p);
    if (moved && moved.status === 'renamed') return { binary: moved.binary };
    return { path: p, binary: false };
  };
}

/**
 * İstemciden gelen depo-göreli yolu doğrular ve normalize eder. Mutlak yol (`/x`, `\x`, `C:\x`, `C:x`),
 * `..` bölümü, NUL ve satır sonu içeren ya da boş yol için undefined döner (yol geçişi koruması).
 */
export function sanitizeRepoRelPath(raw: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (raw === '' || /[\0\r\n]/.test(raw)) return undefined;
  if (raw.startsWith('/')) return undefined;
  // Ters eğik çizgi ve sürücü harfi yalnız Windows'ta yol ayırıcısıdır; POSIX'te dosya adının parçası olabilir.
  const windows = platform === 'win32';
  if (windows && (raw.startsWith('\\') || /^[A-Za-z]:/.test(raw))) return undefined;
  const parts = (windows ? raw.replace(/\\/g, '/') : raw).split('/');
  if (parts.some((s) => s === '..')) return undefined;
  const clean = parts.filter((s) => s !== '' && s !== '.').join('/');
  return clean === '' ? undefined : clean;
}

// ---------------------------------------------------------------------------
// stableKey (ReviewSourceInfo.stableKey)
// ---------------------------------------------------------------------------

/** Depo yolunu anahtar için normalize eder: mutlak, `/` ayraçlı, sonda `/` yok; Windows'ta küçük harf. */
export function normalizeRepoKeyPath(repoPath: string): string {
  let p = resolve(repoPath).replace(/\\/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** `git:<repo>:<baseRef>...<headRef>:<mode>` (kullanıcının verdiği ref adlarıyla; SHA değişse de sabit). */
export function gitStableKey(repoPath: string, baseRef: string, headRef: string, mode: 'range' | 'mergeBase'): string {
  return `git:${normalizeRepoKeyPath(repoPath)}:${baseRef}...${headRef}:${mode}`;
}

/** `worktree:<repo>:<base>` */
export function worktreeStableKey(repoPath: string, base: string): string {
  return `worktree:${normalizeRepoKeyPath(repoPath)}:${base}`;
}

/** `github:<host>/<sahip>/<depo>#<n>`; GitHub adları büyük/küçük harf duyarsız olduğundan küçük harfle. */
export function githubStableKey(host: string, owner: string, repo: string, number: number): string {
  return `github:${host.toLowerCase()}/${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

/** `patch:<sha1 ilk 12>`; CRLF → LF normalize edilir (yapıştırma farkı anahtarı bozmasın). */
export function patchStableKey(text: string): string {
  const sha = createHash('sha1').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  return `patch:${sha.slice(0, 12)}`;
}

/** Uzantı filtresi (büyük/küçük harf duyarsız). */
export function filterByExt(paths: string[], ext?: string): string[] {
  if (!ext) return paths;
  const e = ext.toLowerCase();
  return paths.filter((p) => p.toLowerCase().endsWith(e));
}

/**
 * Ağ yolu mu (UNC: `\\sunucu\pay`, `//sunucu/pay`, `\\?\UNC\…`).
 * Yerel sunucunun başka bir sayfa tarafından uzak SMB paylaşımına bağlanmaya zorlanmasını
 * (Windows kimlik bilgisi sızıntısı) önlemek için depo yollarında reddedilir.
 */
export function isNetworkPath(p: string, platform: NodeJS.Platform = process.platform): boolean {
  // POSIX'te `//x` sıradan yerel bir yoldur; SMB'ye bağlanma riski yalnız Windows'ta vardır.
  return platform === 'win32' && /^[\\/]{2}/.test(p.trim());
}

export const NETWORK_PATH_MESSAGE = 'Ağ yolları (\\\\sunucu\\paylaşım) desteklenmiyor; yerel bir klasör seçin.';

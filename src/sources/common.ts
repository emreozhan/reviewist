/**
 * Kaynaklar arasında paylaşılan yardımcılar: yaşam döngülü ChangeSet tipi, LRU önbellek,
 * ikili içerik tespiti, eşzamanlılık sınırlayıcı, eski/yeni taraf yol eşlemesi.
 */
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
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
}

/** İlk 8000 baytta NUL varsa ikili sayılır (git'in sezgiseliyle aynı). */
export function isBinaryBuffer(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
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
export function sanitizeRepoRelPath(raw: string): string | undefined {
  if (raw === '' || /[\0\r\n]/.test(raw)) return undefined;
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:/.test(raw)) return undefined;
  const parts = raw.replace(/\\/g, '/').split('/');
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

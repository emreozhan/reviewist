/**
 * Klasör seçici (Tur 5): `GET /api/fs/list` için sunucu tarafı dizin listesi.
 * Yalnız klasör adları ve `.git` varlığı döner; dosya içeriği okunmaz. Ağ yolları (UNC) reddedilir:
 * GET istekleri Origin denetiminden geçmediği için bir sayfa `<img src=…>` ile sunucuyu uzak SMB paylaşımına
 * bağlanmaya zorlayamasın (NTLM sızıntısı).
 */
import { access, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { FsEntry, FsListing, FsRoot } from '../shared/types.js';
import { expandHome, isNetworkPath, NETWORK_PATH_MESSAGE } from '../sources/common.js';
import { shortMessage, SourceError } from '../sources/errors.js';

export const FS_LIST_MAX_ENTRIES = 1000;
const GIT_CHECK_CONCURRENCY = 32;
const REPO_ROOT_MAX_DEPTH = 30;
const DRIVE_CHECK_TIMEOUT_MS = 1500;
const DRIVE_CACHE_MS = 30_000;

/** Windows'ta gizli/sistem öznitelikli bilinen klasörler (öznitelik Node'dan ucuza okunamıyor). */
const WINDOWS_HIDDEN_NAMES = new Set(
  [
    '$recycle.bin',
    '$windows.~bt',
    '$windows.~ws',
    '$winreagent',
    '$sysreset',
    'system volume information',
    'recovery',
    'config.msi',
    'documents and settings',
    'programdata',
    'msocache',
    'appdata',
    'application data',
    'cookies',
    'local settings',
    'my documents',
    'nethood',
    'printhood',
    'recent',
    'sendto',
    'start menu',
    'templates',
  ].map((s) => s.toLowerCase()),
);

export interface FsListOptions {
  /** Gizli klasörler de listelensin mi (`hidden=1`). */
  hidden?: boolean;
  /** Sunucunun çalışma dizini / defaultRepoPath (kısayollarda 'cwd'). */
  cwd?: string;
  /** Test için: ev dizini ve platform. */
  homeDir?: string;
  platform?: NodeJS.Platform;
  maxEntries?: number;
}

/** macOS'ta kök dizinde Finder'ın da gizlediği sistem klasörleri. */
const DARWIN_ROOT_HIDDEN = new Set(['bin', 'cores', 'dev', 'etc', 'home', 'net', 'opt', 'private', 'sbin', 'tmp', 'usr', 'var']);
/** Linux'ta kök dizindeki sanal/sistem klasörleri. */
const LINUX_ROOT_HIDDEN = new Set(['boot', 'dev', 'lost+found', 'proc', 'run', 'snap', 'sys']);
/**
 * macOS gizlilik koruması (TCC) altındaki ev klasörleri: içlerine dokunmak izin penceresi açar. Ev dizini listelenirken
 * bunların içinde `.git` aranmaz; kullanıcı klasöre kendisi girdiğinde izin o zaman istenir.
 */
const DARWIN_PROTECTED_HOME = new Set(['Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures']);

export interface HiddenContext {
  /** Listelenen klasör dosya sisteminin kökü mü. */
  atRoot?: boolean;
  /** Listelenen klasör kullanıcının ev dizini mi. */
  atHome?: boolean;
}

/**
 * Klasör adı gizli mi: nokta ile başlayan, (Windows'ta) bilinen sistem/gizli klasör, (macOS/Linux'ta) kökteki sistem
 * klasörleri ve macOS'ta ev dizinindeki `Library`.
 */
export function isHiddenName(name: string, platform: NodeJS.Platform = process.platform, ctx: HiddenContext = {}): boolean {
  if (name.startsWith('.')) return true;
  if (platform === 'win32') return WINDOWS_HIDDEN_NAMES.has(name.toLowerCase());
  if (platform === 'darwin') return (ctx.atRoot === true && DARWIN_ROOT_HIDDEN.has(name)) || (ctx.atHome === true && name === 'Library');
  return ctx.atRoot === true && LINUX_ROOT_HIDDEN.has(name);
}

/** Türkçe yerel duyarlı, sayı bilinçli ad karşılaştırması (eşitlikte ikili karşılaştırma: kararlı sıra). */
const collator = new Intl.Collator('tr', { sensitivity: 'base', numeric: true });
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Sınırlı eşzamanlılıkla eşleme (sıra korunur). */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

const hasGitMarker = (dir: string): Promise<boolean> => exists(join(dir, '.git'));

/** Yukarı doğru `.git` arar (yolun kendisi hariç); bulunursa deponun kökü. */
async function findRepoRoot(start: string): Promise<string | undefined> {
  let cur = start;
  for (let i = 0; i < REPO_ROOT_MAX_DEPTH; i++) {
    const up = dirname(cur);
    if (up === cur) return undefined;
    cur = up;
    if (await hasGitMarker(cur)) return cur;
  }
  return undefined;
}

function parentOf(p: string): string | undefined {
  const up = dirname(p);
  return up === p ? undefined : up;
}

function errCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') return err.code;
  return undefined;
}

function fsError(err: unknown, p: string): SourceError {
  const code = errCode(err);
  if (code === 'EPERM' || code === 'EACCES') {
    const hint =
      process.platform === 'darwin'
        ? ' macOS izin istediyse onaylayın; istemediyse Sistem Ayarları → Gizlilik ve Güvenlik → Dosyalar ve Klasörler bölümünden terminal uygulamasına bu klasör için izin verin.'
        : '';
    return new SourceError(`Bu klasöre erişim izni yok: ${p}.${hint}`, { status: 403, code: 'FORBIDDEN', field: 'path', detail: code });
  }
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new SourceError(`Klasör bulunamadı: ${p}`, { status: 404, code: 'PATH_NOT_FOUND', field: 'path', detail: code });
  }
  return new SourceError(`Klasör okunamadı: ${p}`, { status: 500, code: 'NOT_FOUND', field: 'path', detail: shortMessage(err, 200) });
}

/** İstekteki yolu doğrular ve normalize eder (boşsa ev dizini). */
export function normalizeRequestPath(raw: string | undefined, home: string): string {
  const typed = raw?.trim() ?? '';
  if (typed === '') return resolve(home);
  if (typed.includes('\0')) {
    throw new SourceError('Geçersiz yol.', { status: 400, code: 'VALIDATION', field: 'path' });
  }
  if (isNetworkPath(typed)) {
    throw new SourceError(NETWORK_PATH_MESSAGE, { status: 400, code: 'VALIDATION', field: 'path' });
  }
  // `~` ve `~/klasör` ev dizinine açılır (kabuk bunu yalnız komut satırında yapar).
  const q = expandHome(typed, home);
  // Windows'ta "\klasör" ve "C:klasör" sürücüye göre görelidir; tam yol isteriz.
  const absolute = process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(q) || /^[A-Za-z]:$/.test(q) : isAbsolute(q);
  if (!absolute) {
    throw new SourceError(`Yol mutlak olmalı: ${q}`, { status: 400, code: 'VALIDATION', field: 'path' });
  }
  return resolve(/^[A-Za-z]:$/.test(q) ? `${q}\\` : q);
}

/** Bir dizin girdisi klasör mü (sembolik bağ/junction ise hedefe bakılır). */
async function direntIsDir(dir: string, d: Dirent): Promise<boolean> {
  if (d.isDirectory()) return true;
  if (d.isSymbolicLink()) return await isDirectory(join(dir, d.name));
  return false;
}

/** `path` klasörünün alt klasörlerini listeler. Hatalar Türkçe SourceError (400/403/404). */
export async function listDirectory(rawPath: string | undefined, opts: FsListOptions = {}): Promise<FsListing> {
  const platform = opts.platform ?? process.platform;
  const home = opts.homeDir ?? homedir();
  const max = opts.maxEntries ?? FS_LIST_MAX_ENTRIES;
  const path = normalizeRequestPath(rawPath, home);

  const st = await stat(path).catch((err: unknown) => {
    throw fsError(err, path);
  });
  if (!st.isDirectory()) {
    throw new SourceError(`Bu yol bir klasör değil: ${path}`, { status: 404, code: 'PATH_NOT_FOUND', field: 'path' });
  }

  let dirents: Dirent[];
  try {
    dirents = await readdir(path, { withFileTypes: true });
  } catch (err) {
    throw fsError(err, path);
  }

  const ctx: HiddenContext = { atRoot: parentOf(path) === undefined, atHome: path === resolve(home) };
  const hiddenHere = (name: string): boolean => isHiddenName(name, platform, ctx);
  const candidates = dirents.filter((d) => (d.isDirectory() || d.isSymbolicLink()) && (opts.hidden || !hiddenHere(d.name)));
  const dirFlags = await mapLimit(candidates, GIT_CHECK_CONCURRENCY, (d) => direntIsDir(path, d));
  const names = candidates.filter((_, i) => dirFlags[i]).map((d) => d.name).sort(compareNames);
  const truncated = names.length > max;
  const kept = truncated ? names.slice(0, max) : names;

  const skipGitProbe = (name: string): boolean => platform === 'darwin' && ctx.atHome === true && DARWIN_PROTECTED_HOME.has(name);
  const entries = await mapLimit(kept, GIT_CHECK_CONCURRENCY, async (name): Promise<FsEntry> => {
    const full = join(path, name);
    return { name, path: full, isGitRepo: skipGitProbe(name) ? false : await hasGitMarker(full), hidden: hiddenHere(name) };
  });

  const [isGitRepo, roots] = await Promise.all([hasGitMarker(path), listRoots({ home, cwd: opts.cwd, platform })]);
  const listing: FsListing = { path, isGitRepo, entries, roots, truncated };
  const parent = parentOf(path);
  if (parent !== undefined) listing.parent = parent;
  if (!isGitRepo) {
    const repoRoot = await findRepoRoot(path);
    if (repoRoot !== undefined) listing.repoRoot = repoRoot;
  }
  return listing;
}

// ---------------------------------------------------------------------------
// Kısayollar
// ---------------------------------------------------------------------------

let driveCache: { at: number; drives: string[] } | undefined;

/** Bağlantısı kopuk ağ sürücüsü uzun süre bekletebilir: zaman aşımında yok sayılır. */
async function driveExists(root: string): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((res) => {
    timer = setTimeout(() => res(false), DRIVE_CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([isDirectory(root), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Windows sürücüleri (A–Z), 30 sn önbellekli. */
async function windowsDrives(): Promise<string[]> {
  const now = Date.now();
  if (driveCache && now - driveCache.at < DRIVE_CACHE_MS) return driveCache.drives;
  const letters = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`);
  const flags = await Promise.all(letters.map(driveExists));
  const drives = letters.filter((_, i) => flags[i]);
  driveCache = { at: now, drives };
  return drives;
}

/** macOS: `/Volumes` altındaki harici/ek diskler (açılış diskine giden sembolik bağ hariç). Okunamazsa boş. */
async function macVolumes(): Promise<{ name: string; path: string }[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Dirent[]>((res) => {
    timer = setTimeout(() => res([]), DRIVE_CHECK_TIMEOUT_MS);
  });
  try {
    const dirents = await Promise.race([readdir('/Volumes', { withFileTypes: true }).catch(() => [] as Dirent[]), timeout]);
    return dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({ name: d.name, path: join('/Volumes', d.name) }))
      .sort((a, b) => compareNames(a.name, b.name));
  } finally {
    clearTimeout(timer);
  }
}

/** İlk var olan klasör. */
async function firstDir(candidates: string[]): Promise<string | undefined> {
  for (const c of candidates) if (await isDirectory(c)) return c;
  return undefined;
}

export async function listRoots(opts: { home: string; cwd?: string; platform?: NodeJS.Platform }): Promise<FsRoot[]> {
  const platform = opts.platform ?? process.platform;
  const home = resolve(opts.home);
  const win = platform === 'win32';
  // OneDrive "bilinen klasör taşıma" açıksa Belgeler/Masaüstü OneDrive altında olabilir.
  const oneDrive = win ? [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial, join(home, 'OneDrive')] : [];
  const oneDriveDirs = [...new Set(oneDrive.filter((d): d is string => !!d))];
  const special = (names: string[]): string[] => [...names.map((n) => join(home, n)), ...oneDriveDirs.flatMap((od) => names.map((n) => join(od, n)))];

  const [desktop, documents, downloads, drives, volumes] = await Promise.all([
    firstDir(special(['Desktop', 'Masaüstü'])),
    firstDir(special(['Documents', 'Belgeler'])),
    firstDir([join(home, 'Downloads'), join(home, 'İndirilenler')]),
    win ? windowsDrives() : Promise.resolve(['/']),
    platform === 'darwin' ? macVolumes() : Promise.resolve([]),
  ]);

  const roots: FsRoot[] = [{ label: 'Ev', path: home, kind: 'home' }];
  if (desktop) roots.push({ label: 'Masaüstü', path: desktop, kind: 'special' });
  if (documents) roots.push({ label: 'Belgeler', path: documents, kind: 'special' });
  if (downloads) roots.push({ label: 'İndirilenler', path: downloads, kind: 'special' });
  if (opts.cwd) roots.push({ label: 'Çalışma dizini', path: resolve(opts.cwd), kind: 'cwd' });
  for (const d of drives) roots.push({ label: win ? d.slice(0, 2) : 'Kök (/)', path: d, kind: 'drive' });
  for (const v of volumes) roots.push({ label: v.name, path: v.path, kind: 'drive' });

  const seen = new Set<string>();
  return roots.filter((r) => {
    const key = win ? r.path.toLowerCase() : r.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

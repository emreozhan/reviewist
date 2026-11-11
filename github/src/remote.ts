/**
 * Uzak depo / PR adresi ayrıştırma. Kullanıcının yapıştırdığı adresten git'in getireceği `cloneUrl`, arayüzde
 * gösterilecek `webUrl` ve (yalnız PR başlığı için) GitHub API kökü üretilir.
 *
 * Güvenlik: şifresiz `http://` ve adrese gömülü kullanıcı adı/parola reddedilir; sahip/depo/sunucu adları dar bir
 * karakter kümesiyle sınırlanır (git'e seçenek gibi görünen `-` ile başlayan sunucu adı geçemez). Yerel yol ve
 * `file://` yalnız `REVIEWIST_ALLOW_FILE_REMOTE=1` iken kabul edilir (testler ağsız çalışsın diye).
 */
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceError } from '../../shared/src/sources/errors.js';

export interface RemoteSpec {
  /** Küçük harf sunucu adı (`github.com`, GHE alan adı; https'te port dahil). Yerel test deposunda `local`. */
  host: string;
  owner: string;
  repo: string;
  /** PR adresi verildiyse PR numarası. */
  prNumber?: number;
  /** `git fetch` adresi. */
  cloneUrl: string;
  /** İnsan okur adres: PR'da PR sayfası, aksi halde depo sayfası. */
  webUrl: string;
  /** GitHub REST API kökü; yerel test deposunda boş. */
  apiBase: string;
}

/** Yerel yol ve `file://` adreslerini açan test kancası. */
export const ALLOW_FILE_REMOTE_ENV = 'REVIEWIST_ALLOW_FILE_REMOTE';
/** `ssh` ise https adresleri `git@host:sahip/depo.git` biçiminde getirilir. */
export const GIT_PROTOCOL_ENV = 'REVIEWIST_GIT_PROTOCOL';

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const SSH_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export const ACCEPTED_FORMATS =
  'Kabul edilen biçimler: https://github.com/sahip/depo/pull/12, sahip/depo#12, https://github.com/sahip/depo, ' +
  'git@github.com:sahip/depo.git, ssh://git@sunucu/sahip/depo.git, sahip/depo';

export function fileRemoteAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALLOW_FILE_REMOTE_ENV] === '1';
}

function badUrl(raw: string, why?: string): SourceError {
  const head = why ?? `Geçersiz depo ya da PR adresi: '${raw}'.`;
  return new SourceError(`${head} ${ACCEPTED_FORMATS}`, { status: 400, code: 'BAD_URL', field: 'url' });
}

function validName(s: string): boolean {
  return NAME_RE.test(s) && s !== '.' && s !== '..';
}

function stripGit(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo;
}

function normalizeHost(host: string): string {
  const h = host.toLowerCase();
  return h === 'www.github.com' ? 'github.com' : h;
}

function apiBaseFor(host: string): string {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

/** Sunucu adından port kısmını atar (`host:8443` → `host`). */
export function hostnameOf(host: string): string {
  const i = host.lastIndexOf(':');
  return i > 0 && !host.includes(']') ? host.slice(0, i) : host;
}

function httpsCloneUrl(host: string, owner: string, repo: string, env: NodeJS.ProcessEnv): string {
  if ((env[GIT_PROTOCOL_ENV] ?? '').trim().toLowerCase() === 'ssh') return `git@${hostnameOf(host)}:${owner}/${repo}.git`;
  return `https://${host}/${owner}/${repo}.git`;
}

function makeSpec(
  host: string,
  owner: string,
  repo: string,
  prNumber: number | undefined,
  cloneUrl: string,
): RemoteSpec {
  const base = `https://${host}/${owner}/${repo}`;
  const spec: RemoteSpec = {
    host,
    owner,
    repo,
    cloneUrl,
    webUrl: prNumber !== undefined ? `${base}/pull/${prNumber}` : base,
    apiBase: apiBaseFor(host),
  };
  if (prNumber !== undefined) spec.prNumber = prNumber;
  return spec;
}

function parsePrNumber(raw: string, s: string): number {
  const n = Number(s);
  if (!/^\d{1,9}$/.test(s) || !Number.isSafeInteger(n) || n < 1) throw badUrl(raw, `Geçersiz PR numarası: '${s}'.`);
  return n;
}

/** Windows ya da POSIX mutlak yolu mu (`C:\x`, `C:/x`, `/x`). UNC (`\\sunucu\pay`) burada mutlak sayılmaz. */
function isLocalAbsolutePath(s: string): boolean {
  if (/^[\\/]{2}/.test(s)) return false;
  return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/') || (process.platform === 'win32' && isAbsolute(s) && !s.startsWith('\\'));
}

function sanitizeLocalName(s: string): string {
  const clean = s.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_');
  return clean === '' ? '_' : clean;
}

/** Yerel test deposu (`file://…` ya da mutlak yol, isteğe bağlı `#N` PR soneki). */
function parseLocalRemote(raw: string): RemoteSpec {
  let s = raw;
  let prNumber: number | undefined;
  const pr = /#(\d+)$/.exec(s);
  if (pr) {
    prNumber = parsePrNumber(raw, pr[1] ?? '');
    s = s.slice(0, pr.index);
  }
  let path: string;
  let cloneUrl: string;
  if (/^file:\/\//i.test(s)) {
    try {
      path = fileURLToPath(s);
    } catch {
      throw badUrl(raw);
    }
    cloneUrl = s;
  } else {
    path = resolve(s);
    cloneUrl = path;
  }
  const trimmed = path.replace(/[\\/]+$/, '');
  const repo = sanitizeLocalName(stripGit(basename(trimmed)));
  const owner = sanitizeLocalName(basename(dirname(trimmed)));
  const spec: RemoteSpec = { host: 'local', owner, repo, cloneUrl, webUrl: cloneUrl, apiBase: '' };
  if (prNumber !== undefined) spec.prNumber = prNumber;
  return spec;
}

/**
 * Kullanıcı girdisini ayrıştırır. Geçersizse 400 SourceError (`field: 'url'`).
 *  - PR: `https://github.com/o/r/pull/12[/files…]`, `o/r#12`, GHE `https://sunucu/o/r/pull/12`.
 *  - Depo: `https://github.com/o/r[.git]`, `git@github.com:o/r.git`, `ssh://git@sunucu[:port]/o/r.git`, `o/r`.
 */
export function parseRemoteSpec(input: string, env: NodeJS.ProcessEnv = process.env): RemoteSpec {
  const raw = input.trim();
  if (raw === '') throw new SourceError('Depo ya da PR adresi boş olamaz.', { status: 400, code: 'BAD_URL', field: 'url' });
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f]/.test(raw)) throw badUrl(raw, 'Adres boşluk ya da kontrol karakteri içeremez.');

  // Yerel yol / file:// (yalnız test kancası açıkken)
  if (/^file:/i.test(raw) || isLocalAbsolutePath(raw)) {
    if (!fileRemoteAllowed(env)) {
      throw badUrl(raw, 'Yerel klasörler ve file:// adresleri bu uygulamada desteklenmiyor; yerel depolar için Reviewist Yerel\'i kullanın.');
    }
    return parseLocalRemote(raw);
  }

  // Kısa biçimler: sahip/depo#12, sahip/depo
  const short = /^([^/#:@]+)\/([^/#:@]+)(?:#(\d+))?$/.exec(raw);
  if (short) {
    const [, owner = '', repoRaw = '', num] = short;
    const repo = stripGit(repoRaw);
    if (!validName(owner) || !validName(repo)) throw badUrl(raw);
    const prNumber = num !== undefined ? parsePrNumber(raw, num) : undefined;
    return makeSpec('github.com', owner, repo, prNumber, httpsCloneUrl('github.com', owner, repo, env));
  }

  // scp tarzı SSH: [kullanıcı@]sunucu:sahip/depo[.git]
  const scp = /^(?:([^@/:]+)@)?([^@/:]+):(?!\/)([^/]+)\/([^/]+?)\/?$/.exec(raw);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const [, user, hostRaw = '', owner = '', repoRaw = ''] = scp;
    const repo = stripGit(repoRaw);
    if (user !== undefined && !SSH_USER_RE.test(user)) throw badUrl(raw, `Geçersiz SSH kullanıcı adı: '${user}'.`);
    // Tek harfli "sunucu" Windows'ta sürücü harfidir (git `C:yol`u yerel yol sayar).
    if (!HOST_RE.test(hostRaw) || hostRaw.length < 2) throw badUrl(raw, `Geçersiz sunucu adı: '${hostRaw}'.`);
    if (!validName(owner) || !validName(repo)) throw badUrl(raw);
    const host = normalizeHost(hostRaw);
    return makeSpec(host, owner, repo, undefined, raw);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badUrl(raw);
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol === 'http:') {
    throw badUrl(raw, `Şifresiz http adresleri kabul edilmez; https kullanın: '${raw}'.`);
  }
  if (protocol !== 'https:' && protocol !== 'ssh:') throw badUrl(raw);
  if (!HOST_RE.test(url.hostname)) throw badUrl(raw, `Geçersiz sunucu adı: '${url.hostname}'.`);
  const seg = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));

  if (protocol === 'ssh:') {
    if (url.password !== '') throw badUrl(raw, 'Adreste parola bulunamaz.');
    if (url.username !== '' && !SSH_USER_RE.test(url.username)) throw badUrl(raw, `Geçersiz SSH kullanıcı adı: '${url.username}'.`);
    if (url.search !== '' || url.hash !== '') throw badUrl(raw);
    if (seg.length !== 2) throw badUrl(raw);
    const [owner = '', repoRaw = ''] = seg;
    const repo = stripGit(repoRaw);
    if (!validName(owner) || !validName(repo)) throw badUrl(raw);
    return makeSpec(normalizeHost(url.hostname), owner, repo, undefined, raw);
  }

  // https: `https://github.com:x@evil.example/…` gibi adresler asıl sunucuyu gizler; kimlik bilgisi adrese gömülmez.
  if (url.username !== '' || url.password !== '') {
    throw badUrl(raw, 'Adrese kullanıcı adı/parola gömülemez; kimlik doğrulaması için git credential helper kullanın.');
  }
  const host = normalizeHost(url.host);
  const [owner = '', repoRaw = '', kind, num] = seg;
  const repo = stripGit(repoRaw);
  if (!validName(owner) || !validName(repo)) throw badUrl(raw);
  if (seg.length === 2) {
    return makeSpec(host, owner, repo, undefined, httpsCloneUrl(host, owner, repo, env));
  }
  if ((kind === 'pull' || kind === 'pulls') && num !== undefined) {
    const prNumber = parsePrNumber(raw, num);
    return makeSpec(host, owner, repo, prNumber, httpsCloneUrl(host, owner, repo, env));
  }
  throw badUrl(raw);
}

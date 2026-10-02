/**
 * GitHub PR kaynağı. İki yol:
 *  1) localRepoPath bu PR'ın deposuysa: `git fetch` + createGitChangeSet (en doğru ve hızlı).
 *  2) Aksi halde GitHub REST API: dosya listesi + patch, içerikler `contents` ile, repo indeksi için tarball.
 * Token asla loglanmaz, hata mesajına ya da yanıta konmaz.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { structuredPatch } from 'diff';
import { x as tarExtract, type ReadEntry } from 'tar';
import { z } from 'zod';
import type { ChangeSetFile, FileStatus, ReviewSourceInfo } from '../shared/types.js';
import {
  createLimiter,
  createSideResolver,
  filterByExt,
  isBinaryBuffer,
  LruCache,
  normalizeRepoPath,
  resolveInside,
  type ManagedChangeSet,
} from './common.js';
import { SourceError, shortMessage } from './errors.js';
import { createGitChangeSet, listRemotes, resolveRepoRoot, runGit, runGitResult } from './git.js';
import { parseHunks } from './unifiedDiff.js';

// ---------------------------------------------------------------------------
// URL / token
// ---------------------------------------------------------------------------

export interface PrRef {
  host: string; // 'github.com' ya da GHE alan adı
  owner: string;
  repo: string;
  number: number;
  apiBase: string; // 'https://api.github.com' ya da 'https://{host}/api/v3'
  webUrl: string; // kanonik PR adresi
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

/** `https://github.com/o/r/pull/12[/files...]`, GHE `https://host/o/r/pull/12`, kısa `o/r#12`. */
export function parsePrUrl(input: string): PrRef {
  const raw = input.trim();
  const bad = (): SourceError =>
    new SourceError(
      `Geçersiz PR adresi: '${raw}'. Beklenen biçim: https://github.com/{sahip}/{depo}/pull/{numara}`,
      { status: 400, code: 'BAD_URL' },
    );
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(raw);
  if (short) {
    const [, owner = '', repo = '', num = ''] = short;
    return makeRef('github.com', 'https:', owner, repo, Number(num));
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad();
  const seg = url.pathname.split('/').filter(Boolean);
  const [owner, repo, kind, num] = seg;
  if (!owner || !repo || (kind !== 'pull' && kind !== 'pulls') || !num || !/^\d+$/.test(num)) throw bad();
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) throw bad();
  let host = url.host.toLowerCase();
  if (host === 'www.github.com') host = 'github.com';
  return makeRef(host, url.protocol, owner, repo.replace(/\.git$/, ''), Number(num));
}

function makeRef(host: string, protocol: string, owner: string, repo: string, number: number): PrRef {
  const isDotCom = host === 'github.com';
  return {
    host,
    owner,
    repo,
    number,
    apiBase: isDotCom ? 'https://api.github.com' : `${protocol}//${host}/api/v3`,
    webUrl: `${protocol}//${host}/${owner}/${repo}/pull/${number}`,
  };
}

export const DEFAULT_TOKEN_ENVS = ['GITHUB_TOKEN', 'GH_TOKEN'] as const;

/** Token sırası: istekte verilen → env adları (varsayılan GITHUB_TOKEN, GH_TOKEN). */
export function resolveGithubToken(explicit?: string, envNames: readonly string[] = DEFAULT_TOKEN_ENVS): string | undefined {
  const e = explicit?.trim();
  if (e) return e;
  for (const name of envNames) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** Git remote adresinden host/sahip/depo çıkarır (https, ssh://, scp tarzı git@host:o/r). */
export function parseRemoteUrl(remote: string): { host: string; owner: string; repo: string } | undefined {
  const r = remote.trim();
  let host: string | undefined;
  let path: string | undefined;
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(r);
  if (/^[a-z+]+:\/\//i.test(r)) {
    try {
      const u = new URL(r);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return undefined;
    }
  } else if (scp) {
    host = scp[1];
    path = scp[2];
  }
  if (!host || !path) return undefined;
  const seg = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (seg.length < 2) return undefined;
  const owner = seg[seg.length - 2] ?? '';
  const repo = (seg[seg.length - 1] ?? '').replace(/\.git$/, '');
  return { host: host.toLowerCase(), owner, repo };
}

// ---------------------------------------------------------------------------
// HTTP istemcisi
// ---------------------------------------------------------------------------

const API_VERSION = '2022-11-28';
const USER_AGENT = 'reviewist (+https://github.com)';

function formatReset(resetEpochSec: number | undefined): string {
  if (resetEpochSec === undefined || !Number.isFinite(resetEpochSec)) return 'bir süre sonra';
  const d = new Date(resetEpochSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const mins = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 60000));
  return `saat ${hh}:${mm} civarında (yaklaşık ${mins} dk sonra)`;
}

async function readErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') {
      return parsed.message;
    }
    return text.slice(0, 200);
  } catch {
    return undefined;
  }
}

export class GitHubClient {
  constructor(
    readonly pr: PrRef,
    private readonly token: string | undefined,
  ) {}

  get hasToken(): boolean {
    return this.token !== undefined;
  }

  private headers(accept: string): Record<string, string> {
    const h: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  /** İsteği yapar; ok değilse (ve allow listesinde değilse) Türkçe SourceError fırlatır. */
  async request(path: string, opts: { accept?: string; allowStatus?: number[] } = {}): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.pr.apiBase}${path}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: this.headers(opts.accept ?? 'application/vnd.github+json'), redirect: 'follow' });
    } catch (err) {
      throw new SourceError("GitHub'a bağlanılamadı. Ağ bağlantısını ve adresi kontrol edin.", {
        status: 502,
        code: 'GITHUB_FAILED',
        detail: shortMessage(err),
      });
    }
    if (res.ok || opts.allowStatus?.includes(res.status)) return res;
    throw await this.toError(res);
  }

  async json(path: string): Promise<unknown> {
    const res = await this.request(path);
    return (await res.json()) as unknown;
  }

  private async toError(res: Response): Promise<SourceError> {
    const ghMessage = await readErrorMessage(res);
    const prName = `${this.pr.owner}/${this.pr.repo}#${this.pr.number}`;
    const detail = `HTTP ${res.status}${ghMessage ? `: ${ghMessage}` : ''}`;
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetRaw = res.headers.get('x-ratelimit-reset');
    const reset = resetRaw !== null ? Number(resetRaw) : undefined;
    const isRateLimit =
      res.status === 429 || (res.status === 403 && (remaining === '0' || /rate limit/i.test(ghMessage ?? '')));
    if (res.status === 401) {
      return new SourceError(
        'GitHub token geçersiz ya da süresi dolmuş (401). GITHUB_TOKEN / GH_TOKEN değerini kontrol edin.',
        { status: 401, code: 'GITHUB_AUTH', detail },
      );
    }
    if (isRateLimit) {
      const hint = this.hasToken
        ? ''
        : ' Token olmadan saatte yalnızca 60 istek yapılabilir; daha yüksek sınır için GITHUB_TOKEN ortam değişkenini ayarlayın.';
      return new SourceError(`GitHub API istek sınırı aşıldı. Sınır ${formatReset(reset)} sıfırlanacak.${hint}`, {
        status: 429,
        code: 'GITHUB_RATE_LIMIT',
        detail: reset !== undefined && Number.isFinite(reset) ? `${detail} (reset: ${new Date(reset * 1000).toISOString()})` : detail,
      });
    }
    if (res.status === 403) {
      const msg = this.hasToken
        ? `GitHub erişimi reddedildi (403): ${prName}. Token'ın bu depoya okuma izni (Contents ve Pull requests: read) olmalı.`
        : `GitHub erişimi reddedildi (403): ${prName}. Bu depo için token gerekli; GITHUB_TOKEN ortam değişkenini ayarlayın.`;
      return new SourceError(msg, { status: 403, code: 'GITHUB_FORBIDDEN', detail });
    }
    if (res.status === 404) {
      const msg = this.hasToken
        ? `PR bulunamadı: ${prName}. PR numarasını ve token'ın bu depoya erişimi olduğunu kontrol edin.`
        : `PR bulunamadı: ${prName}. PR yok ya da depo özel; özel depolar için GITHUB_TOKEN (ya da GH_TOKEN) ortam değişkenini ayarlayın.`;
      return new SourceError(msg, { status: 404, code: 'GITHUB_NOT_FOUND', detail });
    }
    return new SourceError(`GitHub API hatası (HTTP ${res.status}).`, { status: 502, code: 'GITHUB_FAILED', detail });
  }
}

// ---------------------------------------------------------------------------
// API şemaları
// ---------------------------------------------------------------------------

const repoSchema = z
  .object({
    full_name: z.string().optional(),
    clone_url: z.string().optional(),
    html_url: z.string().optional(),
  })
  .nullable()
  .optional();

const pullSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().optional(),
  html_url: z.string().optional(),
  changed_files: z.number().optional(),
  user: z.object({ login: z.string() }).nullable().optional(),
  base: z.object({ ref: z.string(), sha: z.string(), repo: repoSchema }),
  head: z.object({ ref: z.string(), sha: z.string(), repo: repoSchema }),
});
type GhPull = z.infer<typeof pullSchema>;

const prFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().default(0),
  deletions: z.number().default(0),
  changes: z.number().default(0),
  patch: z.string().optional(),
  previous_filename: z.string().optional(),
});
type GhPrFile = z.infer<typeof prFileSchema>;

const compareSchema = z.object({ merge_base_commit: z.object({ sha: z.string() }) });

function parseApi<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new SourceError(`GitHub API yanıtı beklenen biçimde değil (${what}).`, {
      status: 502,
      code: 'GITHUB_FAILED',
      detail: shortMessage(r.error),
    });
  }
  return r.data;
}

function mapStatus(s: string): FileStatus {
  switch (s) {
    case 'added':
      return 'added';
    case 'removed':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'copied':
      return 'copied';
    default:
      return 'modified'; // modified, changed, unchanged
  }
}

/** GitHub dosya kaydını ChangeSetFile'a çevirir. */
export function mapPrFile(f: GhPrFile): ChangeSetFile {
  const status = mapStatus(f.status);
  const hunks = f.patch !== undefined ? parseHunks(f.patch) : [];
  // patch yok + satır değişikliği yok + taşıma değil → ikili (ya da yalnız mod değişikliği)
  const binary = f.patch === undefined && f.changes === 0 && status !== 'renamed' && status !== 'copied';
  const file: ChangeSetFile = {
    path: f.filename,
    status,
    binary,
    additions: f.additions,
    deletions: f.deletions,
    hunks,
  };
  if ((status === 'renamed' || status === 'copied') && f.previous_filename) file.oldPath = f.previous_filename;
  return file;
}

// ---------------------------------------------------------------------------
// createGithubChangeSet
// ---------------------------------------------------------------------------

export interface GithubChangeSetOptions {
  url: string;
  token?: string;
  localRepoPath?: string;
  /** Token için bakılacak ortam değişkenleri (varsayılan GITHUB_TOKEN, GH_TOKEN). */
  tokenEnvNames?: readonly string[];
  onProgress?: (msg: string) => void;
}

export const MAX_PR_FILES = 3000;
export const MAX_TARBALL_BYTES = 200 * 1024 * 1024;
const MAX_SYNTH_PATCH_FILES = 20;

function prInfo(pr: PrRef, meta: GhPull): ReviewSourceInfo {
  const info: ReviewSourceInfo = {
    kind: 'github',
    title: meta.title,
    baseRef: meta.base.ref,
    headRef: meta.head.ref,
    baseSha: meta.base.sha,
    headSha: meta.head.sha,
    prUrl: meta.html_url ?? pr.webUrl,
    prNumber: meta.number,
  };
  if (meta.user?.login) info.author = meta.user.login;
  if (meta.body) info.description = meta.body;
  return info;
}

export async function createGithubChangeSet(opts: GithubChangeSetOptions): Promise<ManagedChangeSet> {
  const pr = parsePrUrl(opts.url);
  const token = resolveGithubToken(opts.token, opts.tokenEnvNames ?? DEFAULT_TOKEN_ENVS);
  const client = new GitHubClient(pr, token);
  const progress = opts.onProgress ?? (() => undefined);
  const base = `/repos/${pr.owner}/${pr.repo}`;

  progress(`PR bilgisi alınıyor: ${pr.owner}/${pr.repo}#${pr.number}`);
  const meta = parseApi(pullSchema, await client.json(`${base}/pulls/${pr.number}`), 'pull request');
  const info = prInfo(pr, meta);
  const warnings: string[] = [];

  if (opts.localRepoPath) {
    const local = await tryLocalRepo(pr, meta, info, opts.localRepoPath, warnings, progress);
    if (local) return local;
  }
  return await createApiChangeSet(client, pr, meta, info, warnings, progress);
}

async function tryLocalRepo(
  pr: PrRef,
  meta: GhPull,
  info: ReviewSourceInfo,
  localRepoPath: string,
  warnings: string[],
  progress: (msg: string) => void,
): Promise<ManagedChangeSet | undefined> {
  let top: string;
  try {
    top = await resolveRepoRoot(localRepoPath);
  } catch (err) {
    warnings.push(`Yerel depo kullanılamadı (${shortMessage(err, 120)}); GitHub API kullanılıyor.`);
    return undefined;
  }
  const remotes = await listRemotes(top);
  const remote = remotes.find((r) => {
    const p = parseRemoteUrl(r.url);
    return (
      p !== undefined &&
      p.host === pr.host &&
      p.owner.toLowerCase() === pr.owner.toLowerCase() &&
      p.repo.toLowerCase() === pr.repo.toLowerCase()
    );
  });
  if (!remote) {
    warnings.push(`Yerel depo (${top}) bu PR'ın deposuna (${pr.owner}/${pr.repo}) ait değil; GitHub API kullanılıyor.`);
    return undefined;
  }
  const prRef = `refs/reviewist/pr-${pr.number}`;
  try {
    progress(`git fetch ${remote.name} pull/${pr.number}/head`);
    await runGit(top, ['fetch', '--no-tags', '--quiet', remote.name, `+refs/pull/${pr.number}/head:${prRef}`], {
      timeoutMs: 300_000,
    });
    const hasBase = await runGitResult(top, ['cat-file', '-e', `${meta.base.sha}^{commit}`]);
    if (hasBase.code !== 0) {
      progress(`git fetch ${remote.name} ${meta.base.ref}`);
      await runGit(
        top,
        ['fetch', '--no-tags', '--quiet', remote.name, `+refs/heads/${meta.base.ref}:${prRef}-base`],
        { timeoutMs: 300_000 },
      );
    }
    const hasHead = await runGitResult(top, ['cat-file', '-e', `${meta.head.sha}^{commit}`]);
    const hasBase2 = await runGitResult(top, ['cat-file', '-e', `${meta.base.sha}^{commit}`]);
    const cs = await createGitChangeSet({
      repoPath: top,
      base: hasBase2.code === 0 ? meta.base.sha : `${prRef}-base`,
      head: hasHead.code === 0 ? meta.head.sha : prRef,
      mode: 'mergeBase',
    });
    cs.info = { ...info, repoPath: top, baseSha: cs.info.baseSha, headSha: cs.info.headSha };
    cs.warnings.unshift(...warnings);
    return cs;
  } catch (err) {
    warnings.push(`Yerel depoya PR getirilemedi (${shortMessage(err, 160)}); GitHub API kullanılıyor.`);
    return undefined;
  }
}

interface TarballResult {
  dir: string; // çıkarılan kök (öneksiz)
  paths: string[]; // tarball'daki tüm dosya yolları
  extracted: Set<string>; // diske çıkarılan yollar (.java)
}

async function createApiChangeSet(
  client: GitHubClient,
  pr: PrRef,
  meta: GhPull,
  info: ReviewSourceInfo,
  warnings: string[],
  progress: (msg: string) => void,
): Promise<ManagedChangeSet> {
  const base = `/repos/${pr.owner}/${pr.repo}`;
  const headSha = meta.head.sha;

  // PR diff'i merge-base'e göredir; eski taraf içerikleri de oradan okunmalı.
  let oldSha = meta.base.sha;
  try {
    const cmp = parseApi(compareSchema, await client.json(`${base}/compare/${meta.base.sha}...${headSha}`), 'compare');
    oldSha = cmp.merge_base_commit.sha;
  } catch (err) {
    warnings.push(`Ortak ata (merge-base) alınamadı; eski içerikler hedef dalın ucundan okunuyor (${shortMessage(err, 120)}).`);
  }
  info.baseSha = oldSha;

  progress('PR dosya listesi alınıyor');
  const ghFiles: GhPrFile[] = [];
  for (let page = 1; page <= MAX_PR_FILES / 100; page++) {
    const data = await client.json(`${base}/pulls/${pr.number}/files?per_page=100&page=${page}`);
    const list = parseApi(z.array(prFileSchema), data, 'PR dosyaları');
    ghFiles.push(...list);
    if (list.length < 100) break;
  }
  if ((meta.changed_files ?? 0) > MAX_PR_FILES || ghFiles.length >= MAX_PR_FILES) {
    warnings.push(
      `PR ${meta.changed_files ?? ghFiles.length} dosya değiştiriyor; GitHub API en fazla ${MAX_PR_FILES} dosya döndürür. Tam analiz için yerel depo yolu verin.`,
    );
  }
  const files = ghFiles.map(mapPrFile);
  const sideOf = createSideResolver(files);

  // --- içerik okuma -------------------------------------------------------
  const limit = createLimiter(8);
  const cache = new LruCache<string | null>(64 * 1024 * 1024, (v) => (v === null ? 1 : v.length));
  const inflight = new Map<string, Promise<string | undefined>>();
  let tmpDir: string | undefined;
  let tarball: Promise<TarballResult | undefined> | undefined;
  let tarballDone: TarballResult | undefined;
  let disposed = false;

  const fetchContent = async (sha: string, path: string): Promise<string | undefined> => {
    const key = `${sha}:${path}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit === null ? undefined : hit;
    const running = inflight.get(key);
    if (running) return await running;
    const p = (async () => {
      try {
        let buf: Buffer | undefined;
        if (sha === headSha && tarballDone?.extracted.has(path)) {
          const abs = resolveInside(tarballDone.dir, path);
          if (abs) buf = await readFile(abs).catch(() => undefined);
        }
        if (buf === undefined) {
          const encoded = path.split('/').map(encodeURIComponent).join('/');
          const res = await limit(() =>
            client.request(`${base}/contents/${encoded}?ref=${sha}`, {
              accept: 'application/vnd.github.raw',
              allowStatus: [404],
            }),
          );
          if (res.status === 404) {
            cache.set(key, null);
            return undefined;
          }
          buf = Buffer.from(await res.arrayBuffer());
        }
        const text = isBinaryBuffer(buf) ? null : buf.toString('utf8');
        cache.set(key, text);
        return text === null ? undefined : text;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return await p;
  };

  // --- büyük diff'ler: GitHub patch vermediyse içeriklerden üret ------------
  const missingPatch = files.filter(
    (f) => !f.binary && f.hunks.length === 0 && f.additions + f.deletions > 0,
  );
  for (const f of missingPatch.slice(0, MAX_SYNTH_PATCH_FILES)) {
    try {
      const oldT = sideOf('old', f.path);
      const newT = sideOf('new', f.path);
      const [oldText, newText] = await Promise.all([
        oldT.path !== undefined ? fetchContent(oldSha, oldT.path) : Promise.resolve(''),
        newT.path !== undefined ? fetchContent(headSha, newT.path) : Promise.resolve(''),
      ]);
      if (oldText === undefined || newText === undefined) throw new Error('içerik alınamadı');
      const sp = structuredPatch(f.oldPath ?? f.path, f.path, oldText, newText, undefined, undefined, { context: 3 });
      const text = sp.hunks
        .map((h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join('\n')}`)
        .join('\n');
      f.hunks = parseHunks(text);
    } catch (err) {
      warnings.push(`${f.path}: GitHub diff'i vermedi ve içerikten üretilemedi (${shortMessage(err, 100)}).`);
    }
  }
  if (missingPatch.length > MAX_SYNTH_PATCH_FILES) {
    warnings.push(`${missingPatch.length - MAX_SYNTH_PATCH_FILES} büyük dosyanın diff'i GitHub tarafından verilmedi.`);
  }

  // --- repo geneli liste: tarball ------------------------------------------
  const changedNewPaths = (): string[] => files.filter((f) => f.status !== 'deleted').map((f) => f.path);

  const loadTarball = async (): Promise<TarballResult | undefined> => {
    try {
      progress('Depo arşivi (tarball) indiriliyor');
      const res = await client.request(`${base}/tarball/${headSha}`, { accept: 'application/vnd.github+json' });
      const len = Number(res.headers.get('content-length') ?? '0');
      if (len > MAX_TARBALL_BYTES) {
        await res.body?.cancel();
        throw new Error(`arşiv çok büyük (${Math.round(len / 1024 / 1024)} MB > 200 MB)`);
      }
      if (!res.body) throw new Error('boş yanıt');
      if (disposed) throw new Error('oturum kapatıldı');
      tmpDir = mkdtempSync(join(tmpdir(), 'reviewist-gh-'));
      const dir = tmpDir;
      const paths: string[] = [];
      const extracted = new Set<string>();
      let prefix: string | undefined;
      const unpack = tarExtract({
        cwd: dir,
        filter: (p: string, entry: unknown) => {
          const norm = p.replace(/\\/g, '/');
          const slash = norm.indexOf('/');
          if (slash < 0) return false;
          prefix ??= norm.slice(0, slash);
          const rel = norm.slice(slash + 1);
          const type = (entry as Partial<ReadEntry>).type;
          if (!rel || (type !== 'File' && type !== 'OldFile' && type !== 'ContiguousFile')) return false;
          paths.push(rel);
          if (rel.toLowerCase().endsWith('.java')) {
            extracted.add(rel);
            return true;
          }
          return false;
        },
      });
      const done = new Promise<void>((resolveDone, rejectDone) => {
        unpack.on('close', () => resolveDone());
        unpack.on('error', (e: unknown) => rejectDone(e instanceof Error ? e : new Error(String(e))));
      });
      let total = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        total += value.byteLength;
        if (total > MAX_TARBALL_BYTES) {
          await reader.cancel();
          throw new Error('arşiv 200 MB sınırını aştı');
        }
        if (!unpack.write(Buffer.from(value))) await once(unpack, 'drain');
      }
      unpack.end();
      await done;
      const result: TarballResult = { dir: join(dir, prefix ?? ''), paths, extracted };
      tarballDone = result;
      progress(`Depo arşivi açıldı: ${paths.length} dosya`);
      return result;
    } catch (err) {
      warnings.push(
        `Depo arşivi (tarball) alınamadı: ${shortMessage(err, 160)}. Repo geneli indeks yalnızca PR'da değişen dosyalarla sınırlı; çağıran/alt sınıf bilgisi eksik olabilir.`,
      );
      cleanup();
      return undefined;
    }
  };

  const cleanup = (): void => {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[reviewist] Geçici dizin silinemedi: ${tmpDir} (${shortMessage(err, 100)})`);
      }
      tmpDir = undefined;
    }
    tarballDone = undefined;
  };

  return {
    info,
    files,
    warnings,
    async readFile(side, rawPath) {
      const t = sideOf(side, normalizeRepoPath(rawPath));
      if (t.path === undefined || t.binary) return undefined;
      return await fetchContent(side === 'old' ? oldSha : headSha, t.path);
    },
    async listFiles(_side, ext) {
      tarball ??= loadTarball();
      const t = await tarball;
      return filterByExt(t ? t.paths : changedNewPaths(), ext);
    },
    dispose() {
      disposed = true;
      cache.clear();
      cleanup();
    },
  };
}

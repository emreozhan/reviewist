/**
 * Yerel git deposu kaynakları: commit aralığı (createGitChangeSet), çalışma ağacı (createWorktreeChangeSet),
 * ref listesi (getGitRefs). İçerik okuma kalıcı bir `git cat-file --batch` süreciyle (GitBlobReader) yapılır.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChangeSetFile, GitRefs } from '../shared/types.js';
import {
  createLimiter,
  createSideResolver,
  filterByExt,
  gitStableKey,
  isBinaryContent,
  LruCache,
  resolveInside,
  sanitizeRepoRelPath,
  worktreeStableKey,
  type ManagedChangeSet,
} from './common.js';
import { SourceError } from './errors.js';
import { hunksForAddedContent, parseUnifiedDiff } from './unifiedDiff.js';

// ---------------------------------------------------------------------------
// runGit
// ---------------------------------------------------------------------------

export interface RunGitOptions {
  /** stdin'e yazılacak veri. */
  input?: string | Buffer;
  /** Başarılı sayılan çıkış kodları (varsayılan [0]). */
  okExitCodes?: number[];
  /** Ek ortam değişkenleri (process.env üzerine). */
  env?: Record<string, string>;
  /** Zaman aşımı (ms). Aşılırsa süreç öldürülür. */
  timeoutMs?: number;
  /** `-c anahtar=değer` olarak eklenecek ek yapılandırma. */
  config?: Record<string, string>;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Tüm git çağrılarına eklenen yapılandırma. `core.longpaths`: Windows'ta 260 karakteri aşan yollar (ör. guava). */
const BASE_CONFIG = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.longpaths=true'];

function gitArgs(args: string[], config?: Record<string, string>): string[] {
  const extra: string[] = [];
  for (const [k, v] of Object.entries(config ?? {})) extra.push('-c', `${k}=${v}`);
  return [...BASE_CONFIG, ...extra, ...args];
}

function trimDetail(s: string, max = 400): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** stderr'i Türkçe, yönlendirici bir SourceError'a çevirir. */
function classifyGitError(repoPath: string, args: string[], stderr: string, code: number): SourceError {
  const detail = trimDetail(stderr) || `çıkış kodu ${code}`;
  if (/not a git repository/i.test(stderr)) {
    return new SourceError(`Klasör bir git deposu değil: ${repoPath}`, {
      status: 400,
      code: 'NOT_A_REPO',
      detail,
      field: 'repoPath',
    });
  }
  if (/dubious ownership/i.test(stderr)) {
    return new SourceError(
      `Git bu klasörü güvenli bulmuyor (safe.directory). Şunu çalıştırın: git config --global --add safe.directory "${repoPath}"`,
      { status: 400, code: 'NOT_A_REPO', detail, field: 'repoPath' },
    );
  }
  if (
    /unknown revision|bad revision|ambiguous argument|not a valid object name|needed a single revision|invalid object name|bad object|not a valid commit name/i.test(
      stderr,
    )
  ) {
    return new SourceError('Git referansı bulunamadı. Dal, etiket ya da commit adını kontrol edin.', {
      status: 400,
      code: 'REF_NOT_FOUND',
      detail,
    });
  }
  return new SourceError(`Git komutu başarısız oldu: git ${args[0] ?? ''}`, { status: 500, code: 'GIT_FAILED', detail });
}

function assertDirectory(repoPath: string): void {
  let isDir = false;
  try {
    isDir = statSync(repoPath).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new SourceError(`Klasör bulunamadı: ${repoPath}`, { status: 400, code: 'PATH_NOT_FOUND', field: 'repoPath' });
  }
}

/** git'i çalıştırır; çıkış kodu ne olursa olsun sonucu döner (yalnız süreç başlatılamazsa fırlatır). */
export async function runGitResult(repoPath: string, args: string[], opts: RunGitOptions = {}): Promise<GitResult> {
  assertDirectory(repoPath);
  return await new Promise<GitResult>((resolvePromise, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn('git', gitArgs(args, opts.config), {
        cwd: repoPath,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env ?? {}) },
      });
    } catch (err) {
      reject(gitSpawnError(err));
      return;
    }
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    let timedOut = false;
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, opts.timeoutMs)
        : undefined;
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => errOut.push(c));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(gitSpawnError(err));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(
          new SourceError(`Git komutu zaman aşımına uğradı: git ${args[0] ?? ''}`, {
            status: 504,
            code: 'GIT_FAILED',
          }),
        );
        return;
      }
      resolvePromise({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(errOut).toString('utf8'),
        code: code ?? -1,
      });
    });
    child.stdin.on('error', () => {
      /* süreç erken kapandıysa EPIPE: sonuç 'close' ile raporlanır */
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

function gitSpawnError(err: unknown): SourceError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return new SourceError('Git bulunamadı. Git kurulu olmalı ve PATH içinde bulunmalı.', {
      status: 500,
      code: 'GIT_NOT_FOUND',
    });
  }
  return new SourceError('Git süreci başlatılamadı.', {
    status: 500,
    code: 'GIT_FAILED',
    detail: err instanceof Error ? err.message : String(err),
  });
}

/** git'i çalıştırır ve stdout'u döner; başarısızlıkta Türkçe SourceError fırlatır. */
export async function runGit(repoPath: string, args: string[], opts: RunGitOptions = {}): Promise<string> {
  const r = await runGitResult(repoPath, args, opts);
  const ok = opts.okExitCodes ?? [0];
  if (!ok.includes(r.code)) throw classifyGitError(repoPath, args, r.stderr, r.code);
  return r.stdout;
}

// ---------------------------------------------------------------------------
// Depo / ref yardımcıları
// ---------------------------------------------------------------------------

/** Depo kökünü döner (yerel yol biçiminde). Depo değilse SourceError. */
export async function resolveRepoRoot(repoPath: string): Promise<string> {
  const abs = resolve(repoPath);
  const out = await runGit(abs, ['rev-parse', '--show-toplevel']);
  const top = out.trim();
  if (!top) {
    throw new SourceError(`Klasör bir git deposu değil: ${abs}`, { status: 400, code: 'NOT_A_REPO', field: 'repoPath' });
  }
  return resolve(top);
}

/**
 * Seçenek enjeksiyonuna karşı ref doğrulaması: boş olamaz, '-' ile başlayamaz, boşluk/kontrol karakteri içeremez.
 * (`HEAD~1`, `v1.0^`, SHA gibi revizyon ifadelerine izin verilir; süreç kabuksuz başlatılır.)
 */
export function assertSafeRef(ref: string, field = 'ref'): void {
  // eslint-disable-next-line no-control-regex
  if (!ref || ref.startsWith('-') || /[\x00-\x20\x7f]/.test(ref)) {
    throw new SourceError(`Geçersiz git referansı (${field}): '${ref}'`, { status: 400, code: 'VALIDATION', field });
  }
}

/** Ref'i commit SHA'sına çözer. */
export async function resolveCommit(top: string, ref: string, field = 'ref'): Promise<string> {
  assertSafeRef(ref, field);
  const r = await runGitResult(top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const sha = r.stdout.trim();
  if (r.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    throw new SourceError(`Git referansı bulunamadı (${field}): '${ref}'. Dal, etiket ya da commit adını kontrol edin.`, {
      status: 400,
      code: 'REF_NOT_FOUND',
      detail: trimDetail(r.stderr) || undefined,
      field,
    });
  }
  return sha;
}

function splitNul(out: string): string[] {
  return out.split('\0').filter((s) => s !== '');
}

/** `git ls-tree -r -z --full-tree <commit>` sonucu: tüm yollar + blob yolu → blob SHA. */
export interface GitTree {
  paths: string[];
  blobs: Map<string, string>;
}

/** `ls-tree -z` çıktısını (`<mod> <tür> <sha>\t<yol>`) ayrıştırır. */
export function parseLsTree(out: string): GitTree {
  const paths: string[] = [];
  const blobs = new Map<string, string>();
  for (const rec of splitNul(out)) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const path = rec.slice(tab + 1);
    const [, type = '', sha = ''] = rec.slice(0, tab).split(' ');
    paths.push(path);
    if (type === 'blob') blobs.set(path, sha);
  }
  return { paths, blobs };
}

/** Commit ağacını (yollar + blob SHA'ları) tek git çağrısıyla okur. */
export async function loadGitTree(top: string, commit: string): Promise<GitTree> {
  return parseLsTree(await runGit(top, ['ls-tree', '-r', '-z', '--full-tree', commit]));
}

// ---------------------------------------------------------------------------
// GitBlobReader: kalıcı `git cat-file --batch`
// ---------------------------------------------------------------------------

interface PendingRead {
  resolve: (v: Buffer | undefined) => void;
  reject: (e: Error) => void;
}

export interface GitBlobReaderOptions {
  /** Metin önbelleği üst sınırı (karakter). Varsayılan 64M. */
  maxCacheChars?: number;
}

/**
 * Tek bir `git cat-file --batch` süreciyle blob okur. İstekler borulanır (pipelined): hepsi stdin'e yazılır,
 * yanıtlar sırayla stdout'tan ayrıştırılır. Aynı anahtar için uçuştaki istek paylaşılır, sonuçlar LRU'da tutulur.
 */
export class GitBlobReader {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private pending: PendingRead[] = [];
  private leftover: Buffer = Buffer.alloc(0);
  private body: { size: number; got: number; parts: Buffer[]; isBlob: boolean } | undefined;
  private isClosed = false;
  private readonly cache: LruCache<string | null>;
  private readonly inflight = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly repoPath: string,
    opts: GitBlobReaderOptions = {},
  ) {
    this.cache = new LruCache<string | null>(opts.maxCacheChars ?? 64 * 1024 * 1024, (v) => (v === null ? 1 : v.length));
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** `<rev>:<path>` içeriğini ham bayt olarak okur; yoksa (missing) ya da blob değilse undefined. */
  async read(rev: string, path: string): Promise<Buffer | undefined> {
    if (this.isClosed) throw new Error('GitBlobReader kapatıldı.');
    if (path.includes('\n') || rev.includes('\n') || path === '') return undefined;
    const proc = this.ensureProcess();
    return await new Promise<Buffer | undefined>((res, rej) => {
      this.pending.push({ resolve: res, reject: rej });
      proc.stdin.write(`${rev}:${path}\n`);
    });
  }

  /** Metin olarak okur; ikili ya da yoksa undefined. Sonuç önbelleğe alınır. */
  async readText(rev: string, path: string): Promise<string | undefined> {
    const key = `${rev}:${path}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached === null ? undefined : cached;
    const running = this.inflight.get(key);
    if (running) return await running;
    const p = (async () => {
      try {
        const buf = await this.read(rev, path);
        const text = buf === undefined || isBinaryContent(buf, path) ? null : buf.toString('utf8');
        this.cache.set(key, text);
        return text === null ? undefined : text;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return await p;
  }

  /**
   * Süreci kapatır; bekleyen istekler reddedilir. Dönen Promise süreç çıktığında çözülür
   * (çağıranın beklemesi gerekmez; ör. Windows'ta dizini hemen silmek isteyen testler bekler).
   */
  close(): Promise<void> {
    if (this.isClosed) return this.exited ?? Promise.resolve();
    this.isClosed = true;
    this.cache.clear();
    const proc = this.proc;
    this.proc = undefined;
    this.failAll(new Error('GitBlobReader kapatıldı.'));
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      this.exited = Promise.resolve();
      return this.exited;
    }
    this.exited = new Promise<void>((res) => {
      proc.once('exit', () => res());
      const t = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill();
      }, 2000);
      t.unref();
    });
    proc.stdin.end();
    return this.exited;
  }

  private exited: Promise<void> | undefined;

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const proc = spawn('git', gitArgs(['cat-file', '--batch']), {
      cwd: this.repoPath,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    this.proc = proc;
    this.leftover = Buffer.alloc(0);
    this.body = undefined;
    proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    proc.stderr.on('data', () => {
      /* cat-file --batch hataları stdout'ta 'missing' olarak gelir */
    });
    proc.stdin.on('error', () => {
      /* EPIPE: 'exit' olayında ele alınır */
    });
    proc.on('error', (err) => {
      if (this.proc === proc) this.proc = undefined;
      this.failAll(gitSpawnError(err));
    });
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = undefined;
      if (!this.isClosed) this.failAll(new Error('git cat-file süreci beklenmedik şekilde sonlandı.'));
    });
    return proc;
  }

  private failAll(err: Error): void {
    const list = this.pending;
    this.pending = [];
    this.body = undefined;
    this.leftover = Buffer.alloc(0);
    for (const p of list) p.reject(err);
  }

  private settle(value: Buffer | undefined): void {
    const p = this.pending.shift();
    if (p) p.resolve(value);
  }

  private onData(chunk: Buffer): void {
    let data = this.leftover.length > 0 ? Buffer.concat([this.leftover, chunk]) : chunk;
    this.leftover = Buffer.alloc(0);
    while (data.length > 0) {
      const body = this.body;
      if (body) {
        const need = body.size + 1 - body.got; // gövde + sondaki LF
        if (data.length < need) {
          body.parts.push(data);
          body.got += data.length;
          return;
        }
        body.parts.push(data.subarray(0, need));
        data = data.subarray(need);
        this.body = undefined;
        const all = body.parts.length === 1 ? (body.parts[0] ?? Buffer.alloc(0)) : Buffer.concat(body.parts);
        this.settle(body.isBlob ? all.subarray(0, body.size) : undefined);
        continue;
      }
      const nl = data.indexOf(10);
      if (nl < 0) {
        this.leftover = Buffer.from(data);
        return;
      }
      const header = data.subarray(0, nl).toString('utf8');
      data = data.subarray(nl + 1);
      const m = /^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(header);
      if (m) {
        this.body = { size: Number(m[3]), got: 0, parts: [], isBlob: m[2] === 'blob' };
        continue;
      }
      // '<spec> missing' / '<spec> ambiguous' / bilinmeyen
      this.settle(undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Satır sonu dönüşümü (çalışma ağacı → git'in "clean" görünümü)
// ---------------------------------------------------------------------------

/** Dosya için git'in `crlf`, `text`, `eol` öznitelik değerleri (`set`, `unset`, `unspecified` ya da değer). */
export interface CrlfAttrs {
  crlf?: string;
  text?: string;
  eol?: string;
}

export type AutoCrlf = 'true' | 'input' | 'false';

/**
 * Commit'e alınırken (clean) git'in yapacağı satır sonu işlemi (git convert.c `convert_attrs`):
 * - 'none': dönüşüm yok (`-text`, ya da öznitelik yok ve core.autocrlf=false),
 * - 'text': CRLF → LF her zaman (`text`, `eol=lf|crlf`, `crlf=input`),
 * - 'auto': CRLF → LF yalnız içerik metinse ve indeksteki sürümde CR yoksa (`text=auto`, core.autocrlf=true|input).
 */
export function crlfActionFor(attrs: CrlfAttrs, autocrlf: AutoCrlf): 'none' | 'text' | 'auto' {
  const fromAttr = (v: string | undefined): 'none' | 'text' | 'auto' | undefined => {
    if (v === 'set' || v === 'input') return 'text';
    if (v === 'unset') return 'none';
    if (v === 'auto') return 'auto';
    return undefined;
  };
  let action = fromAttr(attrs.text) ?? fromAttr(attrs.crlf);
  if (action !== 'none' && (attrs.eol === 'lf' || attrs.eol === 'crlf')) {
    action = action === 'auto' ? 'auto' : 'text';
  }
  if (action !== undefined) return action;
  return autocrlf === 'false' ? 'none' : 'auto';
}

/** git'in otomatik (auto) modda "ikili" saydığı içerik: NUL, tek başına CR ya da çok yazdırılamaz bayt. */
export function gitAutoCrlfTreatsAsBinary(buf: Uint8Array): boolean {
  let printable = 0;
  let nonPrintable = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i] ?? 0;
    if (c === 13) {
      if (buf[i + 1] !== 10) return true; // tek başına CR
      continue;
    }
    if (c === 10) continue;
    if (c === 0) return true;
    if (c === 127) nonPrintable++;
    else if (c < 32) {
      if (c === 8 || c === 9 || c === 27 || c === 12) printable++;
      else nonPrintable++;
    } else printable++;
  }
  if (buf.length > 0 && buf[buf.length - 1] === 26) nonPrintable--; // DOS dosya sonu işareti (^Z)
  return printable >> 7 < nonPrintable;
}

function parseAutoCrlf(raw: string): AutoCrlf {
  const v = raw.trim().toLowerCase();
  if (v === 'input') return 'input';
  if (v === 'true' || v === 'yes' || v === 'on' || v === '1') return 'true';
  return 'false';
}

/** `git check-attr -z --stdin crlf text eol` ile yolların özniteliklerini toplu okur. */
export async function loadCrlfAttrs(top: string, paths: Iterable<string>): Promise<Map<string, CrlfAttrs>> {
  const list = [...paths];
  const map = new Map<string, CrlfAttrs>();
  if (list.length === 0) return map;
  const out = await runGit(top, ['check-attr', '-z', '--stdin', 'crlf', 'text', 'eol'], {
    input: `${list.join('\0')}\0`,
  });
  const parts = out.split('\0');
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const path = parts[i] ?? '';
    const attr = parts[i + 1];
    const value = parts[i + 2];
    const e = map.get(path) ?? {};
    if (attr === 'crlf' || attr === 'text' || attr === 'eol') e[attr] = value;
    map.set(path, e);
  }
  return map;
}

/**
 * Diskten okunan çalışma ağacı içeriğini git'in diff'te kullandığı "clean" görünüme getirir: git CRLF → LF
 * dönüşümü uygulayacaksa (core.autocrlf / .gitattributes) aynısı yapılır. Böylece diff hunk'ları ile
 * readFile içeriği aynı satırları gösterir ve LF blob ↔ CRLF disk farkı kozmetik gürültü üretmez.
 * Satır sayısı değişmez (yalnız satır sonundaki CR kaldırılır). `ident`/`working-tree-encoding`/filtreler uygulanmaz.
 */
export function createWorktreeCleaner(
  top: string,
  reader: GitBlobReader,
  allPaths: () => Promise<Iterable<string>>,
): (path: string, buf: Buffer) => Promise<string> {
  type State = { autocrlf: AutoCrlf; attrs: Map<string, CrlfAttrs> };
  let state: Promise<State> | undefined;
  const load = async (): Promise<State> => {
    const cfg = await runGitResult(top, ['config', '--get', 'core.autocrlf']);
    const autocrlf = cfg.code === 0 ? parseAutoCrlf(cfg.stdout) : 'false';
    let attrs = new Map<string, CrlfAttrs>();
    try {
      attrs = await loadCrlfAttrs(top, await allPaths());
    } catch (err) {
      console.warn(
        `[reviewist] .gitattributes okunamadı; yalnız core.autocrlf kullanılıyor (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    return { autocrlf, attrs };
  };
  return async (path, buf) => {
    const text = buf.toString('utf8');
    if (!text.includes('\r\n')) return text;
    state ??= load();
    const s = await state;
    const action = crlfActionFor(s.attrs.get(path) ?? {}, s.autocrlf);
    if (action === 'none') return text;
    if (action === 'auto') {
      if (gitAutoCrlfTreatsAsBinary(buf)) return text;
      // git: indeksteki sürüm CR içeriyorsa dönüştürmez (convert.c has_crlf_in_index).
      if (!reader.closed) {
        const idx = await reader.read(':0', path).catch(() => undefined);
        if (idx !== undefined && idx.includes(13)) return text;
      }
    }
    return text.replace(/\r\n/g, '\n');
  };
}

// ---------------------------------------------------------------------------
// createGitChangeSet
// ---------------------------------------------------------------------------

export interface GitChangeSetOptions {
  repoPath: string;
  base: string;
  head: string;
  /** 'mergeBase' (varsayılan, PR semantiği) ya da 'range' (doğrudan iki commit). */
  mode?: 'range' | 'mergeBase';
  onProgress?: (msg: string) => void;
}

const DIFF_ARGS = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--find-renames',
  '-U3',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];
const DIFF_CONFIG = { 'diff.renameLimit': '20000', 'diff.noprefix': 'false', 'diff.mnemonicPrefix': 'false' };

function diffWarnings(stderr: string): string[] {
  const w: string[] = [];
  if (/rename detection was skipped|exhaustive rename detection was skipped|inexact rename detection was skipped/i.test(stderr)) {
    w.push('Değişiklik çok büyük olduğu için git yeniden adlandırma tespitini kısmen atladı; bazı taşımalar silme+ekleme görünebilir.');
  }
  return w;
}

export async function createGitChangeSet(opts: GitChangeSetOptions): Promise<ManagedChangeSet> {
  const progress = opts.onProgress ?? (() => undefined);
  const mode = opts.mode ?? 'mergeBase';
  const top = await resolveRepoRoot(opts.repoPath);
  const warnings: string[] = [];
  progress(`Git referansları çözülüyor: ${opts.base}...${opts.head}`);
  const baseTip = await resolveCommit(top, opts.base, 'base');
  const headSha = await resolveCommit(top, opts.head, 'head');
  let baseSha = baseTip;
  if (mode === 'mergeBase') {
    const r = await runGitResult(top, ['merge-base', baseTip, headSha]);
    const mb = r.stdout.trim();
    if (r.code === 0 && mb) baseSha = mb;
    else {
      warnings.push(
        `'${opts.base}' ile '${opts.head}' arasında ortak ata bulunamadı; doğrudan iki commit karşılaştırıldı.`,
      );
    }
  }

  progress('git diff alınıyor');
  const diff = await runGitResult(top, [...DIFF_ARGS, baseSha, headSha], { config: DIFF_CONFIG });
  if (diff.code !== 0) throw classifyGitError(top, ['diff'], diff.stderr, diff.code);
  warnings.push(...diffWarnings(diff.stderr));
  const files = parseUnifiedDiff(diff.stdout);
  progress(`git diff ayrıştırıldı: ${files.length} dosya`);

  const reader = new GitBlobReader(top);
  const sideOf = createSideResolver(files);
  let headTree: Promise<GitTree> | undefined;
  let baseTree: Promise<GitTree> | undefined;
  const treeOf = (side: 'old' | 'new'): Promise<GitTree> =>
    side === 'old' ? (baseTree ??= loadGitTree(top, baseSha)) : (headTree ??= loadGitTree(top, headSha));

  return {
    info: {
      kind: 'git',
      title: `${opts.base}...${opts.head}`,
      repoPath: top,
      baseRef: opts.base,
      headRef: opts.head,
      baseSha,
      headSha,
      stableKey: gitStableKey(top, opts.base, opts.head, mode),
    },
    files,
    warnings,
    async readFile(side, rawPath) {
      // Diff dışındaki dosyalar da okunabilir: eşleşme yoksa ilgili commit ağacından (baseSha/headSha) okunur.
      const path = sanitizeRepoRelPath(rawPath);
      if (path === undefined) return undefined;
      const t = sideOf(side, path);
      if (t.path === undefined || t.binary || reader.closed) return undefined;
      return await reader.readText(side === 'old' ? baseSha : headSha, t.path);
    },
    async listFiles(_side, ext) {
      return filterByExt((await treeOf('new')).paths, ext);
    },
    async blobId(side, rawPath) {
      // Blob SHA'sı commit ağacından (ls-tree, taraf başına bir kez); readFile ile aynı yol eşlemesi.
      const path = sanitizeRepoRelPath(rawPath);
      if (path === undefined) return undefined;
      const t = sideOf(side, path);
      if (t.path === undefined || t.binary) return undefined;
      return (await treeOf(side)).blobs.get(t.path);
    },
    dispose() {
      return reader.close();
    },
  };
}

// ---------------------------------------------------------------------------
// createWorktreeChangeSet
// ---------------------------------------------------------------------------

export interface WorktreeChangeSetOptions {
  repoPath: string;
  base?: string;
  includeUntracked?: boolean;
  onProgress?: (msg: string) => void;
}

const MAX_UNTRACKED = 2000;
const MAX_UNTRACKED_BYTES = 5 * 1024 * 1024;

export async function createWorktreeChangeSet(opts: WorktreeChangeSetOptions): Promise<ManagedChangeSet> {
  const progress = opts.onProgress ?? (() => undefined);
  const top = await resolveRepoRoot(opts.repoPath);
  const base = opts.base ?? 'HEAD';
  const warnings: string[] = [];
  const baseSha = await resolveCommit(top, base, 'base');

  progress(`Çalışma ağacı diff'i alınıyor (taban: ${base})`);
  const diff = await runGitResult(top, [...DIFF_ARGS, baseSha], { config: DIFF_CONFIG });
  if (diff.code !== 0) throw classifyGitError(top, ['diff'], diff.stderr, diff.code);
  warnings.push(...diffWarnings(diff.stderr));
  const files: ChangeSetFile[] = parseUnifiedDiff(diff.stdout);

  if (opts.includeUntracked ?? true) {
    const untracked = splitNul(await runGit(top, ['ls-files', '-z', '--others', '--exclude-standard']));
    const known = new Set(files.map((f) => f.path));
    let list = untracked.filter((p) => !known.has(p));
    if (list.length > 0) progress(`İzlenmeyen dosyalar okunuyor: ${list.length}`);
    if (list.length > MAX_UNTRACKED) {
      warnings.push(`${list.length} izlenmeyen dosya var; yalnızca ilk ${MAX_UNTRACKED} tanesi dahil edildi.`);
      list = list.slice(0, MAX_UNTRACKED);
    }
    const limit = createLimiter(16);
    const added = await Promise.all(
      list.map((p) =>
        limit(async (): Promise<ChangeSetFile | undefined> => {
          const abs = resolveInside(top, p);
          if (!abs) return undefined;
          let buf: Buffer;
          try {
            buf = await readFile(abs);
          } catch {
            return undefined; // okunamayan (ör. silinmiş, dizin bağlantısı) dosya atlanır
          }
          if (isBinaryContent(buf, p) || buf.length > MAX_UNTRACKED_BYTES) {
            return { path: p, status: 'added', binary: true, additions: 0, deletions: 0, hunks: [] };
          }
          const { hunks, additions } = hunksForAddedContent(buf.toString('utf8'));
          return { path: p, status: 'added', binary: false, additions, deletions: 0, hunks };
        }),
      ),
    );
    for (const f of added) if (f) files.push(f);
  }

  const reader = new GitBlobReader(top);
  const sideOf = createSideResolver(files);
  let allowed: Promise<Set<string>> | undefined;
  const loadAllowed = (): Promise<Set<string>> => {
    allowed ??= runGit(top, ['ls-files', '-z', '-co', '--exclude-standard']).then((out) => {
      const set = new Set(splitNul(out));
      for (const f of files) if (f.status !== 'deleted') set.add(f.path);
      for (const f of files) if (f.status === 'deleted') set.delete(f.path);
      for (const f of files) if (f.status === 'renamed' && f.oldPath !== undefined) set.delete(f.oldPath);
      return set;
    });
    return allowed;
  };
  const toGitText = createWorktreeCleaner(top, reader, loadAllowed);
  let baseTree: Promise<GitTree> | undefined;

  return {
    info: {
      kind: 'git',
      title: `${base}...çalışma ağacı`,
      repoPath: top,
      baseRef: base,
      headRef: 'WORKTREE',
      baseSha,
      stableKey: worktreeStableKey(top, base),
    },
    files,
    warnings,
    async readFile(side, rawPath) {
      // Diff dışı dosyalar: eski taraf taban commit ağacından, yeni taraf diskten (yalnız ls-files kümesindekiler).
      const path = sanitizeRepoRelPath(rawPath);
      if (path === undefined) return undefined;
      const t = sideOf(side, path);
      if (t.path === undefined || t.binary) return undefined;
      if (side === 'old') {
        if (reader.closed) return undefined;
        return await reader.readText(baseSha, t.path);
      }
      // Yalnızca izlenen/izlenmeyen-ama-yoksayılmayan dosyalar diskten okunur (.env gibi yoksayılanlar asla).
      const set = await loadAllowed();
      if (!set.has(t.path)) return undefined;
      const abs = resolveInside(top, t.path);
      if (!abs) return undefined;
      try {
        const buf = await readFile(abs);
        return isBinaryContent(buf, t.path) ? undefined : await toGitText(t.path, buf);
      } catch {
        return undefined;
      }
    },
    async listFiles(_side, ext) {
      return filterByExt([...(await loadAllowed())].sort(), ext);
    },
    async blobId(side, rawPath) {
      // Yeni taraf diskten okunur: kararlı kimliği yok (hash-object maliyeti yerine undefined).
      if (side === 'new') return undefined;
      const path = sanitizeRepoRelPath(rawPath);
      if (path === undefined) return undefined;
      const t = sideOf('old', path);
      if (t.path === undefined || t.binary) return undefined;
      baseTree ??= loadGitTree(top, baseSha);
      return (await baseTree).blobs.get(t.path);
    },
    dispose() {
      return reader.close();
    },
  };
}

// ---------------------------------------------------------------------------
// getGitRefs
// ---------------------------------------------------------------------------

const MAX_TAGS = 200;

export async function getGitRefs(repoPath: string): Promise<GitRefs> {
  const top = await resolveRepoRoot(repoPath);
  const refsOut = await runGit(top, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads',
    'refs/remotes',
  ]);
  const branches: string[] = [];
  const remoteBranches: string[] = [];
  for (const line of refsOut.split('\n')) {
    const ref = line.trim();
    if (ref.startsWith('refs/heads/')) branches.push(ref.slice('refs/heads/'.length));
    else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) remoteBranches.push(ref.slice('refs/remotes/'.length));
  }
  const tagsOut = await runGit(top, ['for-each-ref', '--sort=-creatordate', `--count=${MAX_TAGS}`, '--format=%(refname:strip=2)', 'refs/tags']);
  const tags = tagsOut.split('\n').map((s) => s.trim()).filter(Boolean);

  const cur = await runGitResult(top, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const currentBranch = cur.code === 0 && cur.stdout.trim() ? cur.stdout.trim() : undefined;

  let recentCommits: GitRefs['recentCommits'] = [];
  const log = await runGitResult(top, ['log', '-n', '30', '--format=%H%x1f%s%x1f%an%x1f%aI%x1e', 'HEAD']);
  if (log.code === 0) {
    recentCommits = log.stdout
      .split('\x1e')
      .map((rec) => rec.replace(/^\s+/, ''))
      .filter((rec) => rec !== '')
      .map((rec) => {
        const [sha = '', subject = '', author = '', date = ''] = rec.split('\x1f');
        return { sha, subject, author, date: date.trim() };
      });
  }

  let defaultBase: string | undefined;
  const originHead = await runGitResult(top, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead.code === 0 && originHead.stdout.trim()) defaultBase = originHead.stdout.trim();
  else defaultBase = ['main', 'master', 'develop'].find((b) => branches.includes(b));

  return {
    repoPath: top,
    currentBranch,
    defaultBase,
    branches: branches.sort((a, b) => a.localeCompare(b)),
    remoteBranches: remoteBranches.sort((a, b) => a.localeCompare(b)),
    tags,
    recentCommits,
  };
}

// ---------------------------------------------------------------------------
// Uzak depo yardımcıları (github.ts kullanır)
// ---------------------------------------------------------------------------

export interface GitRemote {
  name: string;
  url: string;
}

/**
 * Uzak depoları listeler. Hem ham yapılandırmadaki adres (`remote.<ad>.url`) hem de `url.*.insteadOf`
 * kuralları uygulanmış adres (`git remote -v`) döner; aynı ad birden çok kez görünebilir.
 */
export async function listRemotes(top: string): Promise<GitRemote[]> {
  const seen = new Set<string>();
  const remotes: GitRemote[] = [];
  const raw = await runGit(top, ['config', '--get-regexp', '^remote\\..*\\.url$'], { okExitCodes: [0, 1] });
  for (const line of raw.split('\n')) {
    const m = /^remote\.(.+)\.url\s+(\S+)$/.exec(line.trim());
    if (!m) continue;
    const key = `${m[1]}\t${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    remotes.push({ name: m[1] ?? '', url: m[2] ?? '' });
  }
  const out = await runGit(top, ['remote', '-v']);
  for (const line of out.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(line.trim());
    if (!m || m[3] !== 'fetch') continue;
    const key = `${m[1]}\t${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    remotes.push({ name: m[1] ?? '', url: m[2] ?? '' });
  }
  return remotes;
}

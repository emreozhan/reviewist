/**
 * Uzak depo kaynağı: depoyu yerel önbelleğe `git fetch` ile getirir, sonra ortak git kaynağıyla
 * (`createGitChangeSet`, merge-base semantiği) inceler. Önbellek deposu bare değildir ama çalışma ağacına ASLA
 * checkout yapılmaz; yalnız `.git` kullanılır. PR modunda başlık/taban dal için tek bir GitHub API isteği yapılır
 * (başarısızsa uyarı verilip devam edilir).
 *
 * Ağ trafiği (sırayla, depo kilidi altında): `git ls-remote` (ref'lerin varlığı, varsayılan dal) + tek `git fetch`.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewSourceInfo } from '../../shared/src/shared/types.js';
import { githubStableKey, type ManagedChangeSet } from '../../shared/src/sources/common.js';
import { isSourceError, SourceError } from '../../shared/src/sources/errors.js';
import { createGitChangeSet, runGit, runGitResult, type GitResult, type RunGitOptions } from '../../shared/src/sources/git.js';
import { repoDirFor, withRepoLock } from './cache.js';
import { fetchPrInfo, type PrInfo } from './prInfo.js';
import { fileRemoteAllowed, parseRemoteSpec, type RemoteSpec } from './remote.js';

export interface GithubChangeSetOptions {
  /** PR ya da depo adresi (bkz. parseRemoteSpec). */
  url: string;
  /** Taban dal (ya da etiket). PR'da verilirse PR bilgisinin yerine geçer; depo modunda verilmezse varsayılan dal. */
  base?: string;
  /** İncelenecek dal, etiket ya da commit SHA'sı. Depo modunda zorunlu; PR'da verilirse PR başının yerine geçer. */
  head?: string;
  /** Klon önbelleği kökü (bkz. resolveCacheDir). */
  cacheDir: string;
  /** PR bilgisi için token ortam değişkenleri (varsayılan GITHUB_TOKEN, GH_TOKEN). */
  tokenEnvNames?: readonly string[];
  onProgress?: (msg: string) => void;
}

const FETCH_TIMEOUT_MS = 15 * 60_000;
const LS_REMOTE_TIMEOUT_MS = 2 * 60_000;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

// ---------------------------------------------------------------------------
// Ref adı doğrulama ve kodlama
// ---------------------------------------------------------------------------

/**
 * Kullanıcıdan (ya da GitHub API'den) gelen dal/etiket adını doğrular: seçenek enjeksiyonu ve refspec bozulmasına
 * karşı `-` ile başlayamaz; boşluk/kontrol karakteri, `..`, `:`, `^`, `~`, `?`, `*`, `[`, `\`, `@{` içeremez.
 */
export function assertRefName(name: string, field: string): void {
  const bad =
    name === '' ||
    name.length > 255 ||
    name.startsWith('-') ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x20\x7f]/.test(name) ||
    name.includes('..') ||
    /[:^~?*[\\]/.test(name) ||
    name.includes('@{') ||
    name.includes('//') ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.endsWith('.lock') ||
    /(^|\/)\./.test(name);
  if (bad) {
    throw new SourceError(`Geçersiz dal/etiket adı (${field}): '${name}'. Boşluk, '..', ':', '^', '~', '?', '*', '[', '\\' içeremez ve '-' ile başlayamaz.`, {
      status: 400,
      code: 'VALIDATION',
      field,
    });
  }
}

/**
 * Önbellek deposundaki hedef ref'in tek parçalı adı: `/` ve `%` kodlanır. Böylece `release` ile `release/1.0` gibi
 * dallar aynı önbellekte dosya/klasör çakışması (`refs/x` ile `refs/x/y`) yaratmaz.
 */
export function encodeRefPart(name: string): string {
  return name.replace(/%/g, '%25').replace(/\//g, '%2F');
}

// ---------------------------------------------------------------------------
// git ağ çağrıları
// ---------------------------------------------------------------------------

function networkGitOptions(timeoutMs: number): RunGitOptions {
  const config: Record<string, string> = {
    // Yalnız https ve ssh taşıyıcıları açıktır: `ext::` (komut çalıştırır), şifresiz `git://` ve `http://` ile diğer
    // yardımcı taşıyıcılar kapalıdır; yerel yol/file:// yalnız test kancası açıkken.
    'protocol.allow': 'never',
    'protocol.https.allow': 'always',
    'protocol.ssh.allow': 'always',
    'protocol.ext.allow': 'never',
    // Kimlik bilgisi penceresi açılmasın (sunucu arka planda çalışır); git'in önbelleğe aldığı bilgi kullanılır.
    'credential.interactive': 'false',
    'gc.autoDetach': 'false',
    'maintenance.autoDetach': 'false',
  };
  config['protocol.file.allow'] = fileRemoteAllowed() ? 'always' : 'never';
  return { timeoutMs, config, env: { GCM_INTERACTIVE: 'never' } };
}

function trimDetail(s: string, max = 400): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Uzak depo erişim hatasını (git stderr) Türkçe, yönlendirici SourceError'a çevirir. */
export function mapRemoteGitError(stderr: string, code: number, remote: RemoteSpec, refField = 'head'): SourceError {
  const detail = trimDetail(stderr) || `çıkış kodu ${code}`;
  const name = `${remote.owner}/${remote.repo}`;
  if (
    /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey|Host key verification failed|HTTP Basic: Access denied|Invalid username or (password|token)/i.test(
      stderr,
    )
  ) {
    return new SourceError(
      `Depoya erişilemedi: kimlik doğrulaması gerekli (${name}). git'in bu depoya erişebildiğinden emin olun ` +
        `(credential helper / SSH anahtarı; terminalde \`git ls-remote ${remote.cloneUrl}\` ile deneyin). ` +
        'SSH ile erişiyorsanız REVIEWIST_GIT_PROTOCOL=ssh ayarlayın ya da git@ biçimli adres verin.',
      { status: 401, code: 'GITHUB_AUTH', detail, field: 'url' },
    );
  }
  if (/transport '[^']*' not allowed/i.test(stderr)) {
    return new SourceError('Bu adres türü güvenlik nedeniyle kapalı (yalnız https ve ssh desteklenir).', {
      status: 400,
      code: 'BAD_URL',
      detail,
      field: 'url',
    });
  }
  if (/couldn't find remote ref|no such remote ref/i.test(stderr)) {
    return new SourceError(`Dal ya da PR uzak depoda bulunamadı (${name}). Adı kontrol edin.`, {
      status: 400,
      code: 'REF_NOT_FOUND',
      detail,
      field: refField,
    });
  }
  if (/not our ref|unadvertised object|want .* not valid/i.test(stderr)) {
    return new SourceError(`Commit uzak depoda bulunamadı ya da getirilemiyor (${name}). Tam (40 haneli) SHA verin ya da dal adı kullanın.`, {
      status: 400,
      code: 'REF_NOT_FOUND',
      detail,
      field: 'head',
    });
  }
  if (/Repository not found|repository '[^']*' not found|does not appear to be a git repository|not found/i.test(stderr)) {
    return new SourceError(
      `Depo bulunamadı ya da erişim izniniz yok: ${name}. Adresi kontrol edin; özel bir depoysa git'in erişebildiğinden ` +
        `emin olun (\`git ls-remote ${remote.cloneUrl}\`).`,
      { status: 404, code: 'GITHUB_NOT_FOUND', detail, field: 'url' },
    );
  }
  if (
    /Could not resolve host|unable to access|Failed to connect|Connection (timed out|refused|reset)|Operation timed out|Could not read from remote repository|early EOF|RPC failed|SSL|Network is unreachable/i.test(
      stderr,
    )
  ) {
    return new SourceError(`Uzak depoya bağlanılamadı (${remote.host}). Ağ bağlantısını, vekil sunucu ayarlarını ve adresi kontrol edin.`, {
      status: 502,
      code: 'GITHUB_FAILED',
      detail,
      field: 'url',
    });
  }
  return new SourceError(`Uzak depo işlemi başarısız oldu (${name}).`, { status: 502, code: 'GIT_FAILED', detail, field: 'url' });
}

async function runRemoteGit(dir: string, args: string[], remote: RemoteSpec, timeoutMs: number, refField?: string): Promise<string> {
  let r: GitResult;
  try {
    r = await runGitResult(dir, args, networkGitOptions(timeoutMs));
  } catch (err) {
    if (isSourceError(err) && err.status === 504) {
      throw new SourceError(`Uzak depo ${Math.round(timeoutMs / 60_000)} dakikada yanıt vermedi (git ${args[0] ?? ''}); bağlantıyı kontrol edip yeniden deneyin.`, {
        status: 504,
        code: 'GITHUB_FAILED',
        field: 'url',
      });
    }
    throw err;
  }
  if (r.code !== 0) throw mapRemoteGitError(r.stderr, r.code, remote, refField);
  return r.stdout;
}

export interface LsRemoteResult {
  /** `HEAD`'in gösterdiği dal (ör. `main`), varsa. */
  defaultBranch?: string;
  /** Tam ref adı → SHA. */
  refs: Map<string, string>;
}

/** `git ls-remote --symref` çıktısını ayrıştırır. */
export function parseLsRemote(out: string): LsRemoteResult {
  const refs = new Map<string, string>();
  let defaultBranch: string | undefined;
  for (const line of out.split('\n')) {
    const l = line.replace(/\r$/, '');
    const sym = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(l);
    if (sym) {
      defaultBranch = sym[1];
      continue;
    }
    const m = /^([0-9a-f]{40,64})\t(\S+)$/.exec(l);
    if (m) refs.set(m[2] ?? '', m[1] ?? '');
  }
  return defaultBranch !== undefined ? { defaultBranch, refs } : { refs };
}

// ---------------------------------------------------------------------------
// Önbellek deposu
// ---------------------------------------------------------------------------

async function ensureCacheRepo(dir: string, remote: RemoteSpec): Promise<void> {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, '.git'))) await runGit(dir, ['init', '-q']);
  // Adres her seferinde güncellenir (REVIEWIST_GIT_PROTOCOL değişmiş olabilir).
  await runGit(dir, ['config', 'remote.origin.url', remote.cloneUrl]);
}

async function localCommit(dir: string, rev: string): Promise<string | undefined> {
  const r = await runGitResult(dir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  const sha = r.stdout.trim();
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : undefined;
}

// ---------------------------------------------------------------------------
// createGithubChangeSet
// ---------------------------------------------------------------------------

type HeadTarget =
  | { kind: 'pr'; n: number }
  | { kind: 'branch'; name: string }
  | { kind: 'tag'; name: string }
  | { kind: 'sha'; sha: string };

interface Fetched {
  baseName: string;
  headLabel: string;
  baseSha: string;
  headSha: string;
}

export async function createGithubChangeSet(opts: GithubChangeSetOptions): Promise<ManagedChangeSet> {
  const progress = opts.onProgress ?? (() => undefined);
  const remote = parseRemoteSpec(opts.url);
  const isPr = remote.prNumber !== undefined;
  const base = opts.base?.trim() || undefined;
  const head = opts.head?.trim() || undefined;
  if (base !== undefined) assertRefName(base, 'base');
  if (head !== undefined && !SHA_RE.test(head)) assertRefName(head, 'head');
  if (!isPr && head === undefined) {
    throw new SourceError('Depo adresi verildiğinde incelenecek dal (head) zorunludur: dal, etiket ya da commit SHA\'sı girin.', {
      status: 400,
      code: 'VALIDATION',
      field: 'head',
    });
  }

  const warnings: string[] = [];
  const dir = repoDirFor(opts.cacheDir, remote);
  const repoName = `${remote.owner}/${remote.repo}`;
  let pr: PrInfo | undefined;

  const fetched = await withRepoLock(dir, async (): Promise<Fetched> => {
    progress(`Depo önbelleği hazırlanıyor: ${repoName}`);
    await ensureCacheRepo(dir, remote);

    // 3. PR bilgisi (tek API isteği; başarısızsa uyarı)
    if (remote.prNumber !== undefined) {
      progress(`PR bilgisi alınıyor: ${repoName}#${remote.prNumber}`);
      const r = await fetchPrInfo(remote, { tokenEnvNames: opts.tokenEnvNames });
      if (r.ok) pr = r.info;
      else if (remote.host !== 'local') warnings.push(r.reason);
    }

    // Taban ve baş hedefi
    let baseName = base ?? pr?.baseRef;
    if (baseName !== undefined && base === undefined) assertRefName(baseName, 'base');
    let target: HeadTarget | undefined =
      head === undefined && remote.prNumber !== undefined ? { kind: 'pr', n: remote.prNumber } : undefined;

    // Uzak ref'ler: varlık denetimi + gerekirse varsayılan dal (tek ls-remote)
    const patterns: string[] = [];
    if (baseName === undefined) patterns.push('HEAD');
    else patterns.push(`refs/heads/${baseName}`, `refs/tags/${baseName}`);
    if (target?.kind === 'pr') patterns.push(`refs/pull/${target.n}/head`);
    if (head !== undefined) patterns.push(`refs/heads/${head}`, `refs/tags/${head}`);
    progress(`Uzak depo sorgulanıyor: ${remote.host === 'local' ? repoName : remote.webUrl}`);
    const ls = parseLsRemote(
      await runRemoteGit(dir, ['ls-remote', '--symref', 'origin', ...patterns], remote, LS_REMOTE_TIMEOUT_MS),
    );

    let baseKind: 'branch' | 'tag' = 'branch';
    if (baseName === undefined) {
      baseName = ls.defaultBranch;
      if (baseName === undefined || !ls.refs.has('HEAD')) {
        throw new SourceError('Taban dal belirlenemedi; taban dalı girin.', { status: 400, code: 'REF_NOT_FOUND', field: 'base' });
      }
      assertRefName(baseName, 'base');
    } else if (ls.refs.has(`refs/heads/${baseName}`)) {
      baseKind = 'branch';
    } else if (ls.refs.has(`refs/tags/${baseName}`)) {
      baseKind = 'tag';
    } else {
      throw new SourceError(`Taban dal uzak depoda bulunamadı: '${baseName}' (${repoName}). Dal adını kontrol edin.`, {
        status: 400,
        code: 'REF_NOT_FOUND',
        field: 'base',
      });
    }

    if (target?.kind === 'pr' && !ls.refs.has(`refs/pull/${target.n}/head`)) {
      throw new SourceError(`PR bulunamadı: ${repoName}#${target.n} (uzak depoda refs/pull/${target.n}/head yok). PR numarasını kontrol edin.`, {
        status: 404,
        code: 'GITHUB_NOT_FOUND',
        field: 'url',
      });
    }
    if (head !== undefined) {
      if (ls.refs.has(`refs/heads/${head}`)) target = { kind: 'branch', name: head };
      else if (ls.refs.has(`refs/tags/${head}`)) target = { kind: 'tag', name: head };
      else if (SHA_RE.test(head)) target = { kind: 'sha', sha: head.toLowerCase() };
      else {
        throw new SourceError(`Dal ya da etiket uzak depoda bulunamadı: '${head}' (${repoName}). Adı kontrol edin.`, {
          status: 400,
          code: 'REF_NOT_FOUND',
          field: 'head',
        });
      }
    }
    if (target === undefined) throw new Error('head hedefi belirlenemedi');

    // 4. Tek fetch
    const baseDst =
      baseKind === 'branch' ? `refs/reviewist/base/${encodeRefPart(baseName)}` : `refs/reviewist/base-tag/${encodeRefPart(baseName)}`;
    const refspecs = [`+refs/${baseKind === 'branch' ? 'heads' : 'tags'}/${baseName}:${baseDst}`];
    let headDst: string | undefined;
    let headLabel: string;
    switch (target.kind) {
      case 'pr':
        headDst = `refs/reviewist/pr/${target.n}`;
        refspecs.push(`+refs/pull/${target.n}/head:${headDst}`);
        headLabel = pr?.headRef ?? `pull/${target.n}/head`;
        break;
      case 'branch':
        headDst = `refs/reviewist/head/${encodeRefPart(target.name)}`;
        refspecs.push(`+refs/heads/${target.name}:${headDst}`);
        headLabel = target.name;
        break;
      case 'tag':
        headDst = `refs/reviewist/tag/${encodeRefPart(target.name)}`;
        refspecs.push(`+refs/tags/${target.name}:${headDst}`);
        headLabel = target.name;
        break;
      case 'sha':
        headLabel = target.sha;
        // Tam SHA önbellekte yoksa doğrudan istenir (GitHub erişilebilir commit'lerin SHA ile getirilmesine izin verir).
        if (target.sha.length === 40 && (await localCommit(dir, target.sha)) === undefined) refspecs.push(target.sha);
        break;
    }
    progress(`git fetch: ${refspecs.length} ref getiriliyor (ilk getirmede büyük depolar uzun sürebilir)`);
    await runRemoteGit(
      dir,
      ['fetch', '--no-tags', '--no-recurse-submodules', '--prune', 'origin', ...refspecs],
      remote,
      FETCH_TIMEOUT_MS,
      target.kind === 'pr' ? 'url' : 'head',
    );

    const baseSha = await localCommit(dir, baseDst);
    if (baseSha === undefined) {
      throw new SourceError(`Taban dal getirilemedi: '${baseName}'.`, { status: 502, code: 'GIT_FAILED', field: 'base' });
    }
    let headSha: string | undefined;
    if (target.kind === 'sha') {
      headSha = await localCommit(dir, target.sha);
      if (headSha === undefined) {
        throw new SourceError(
          target.sha.length < 40
            ? `Commit bulunamadı: '${target.sha}'. Kısa SHA yalnız önbellekte zaten varsa çözülebilir; tam (40 haneli) SHA verin.`
            : `Commit uzak depoda bulunamadı: '${target.sha}'.`,
          { status: 400, code: 'REF_NOT_FOUND', field: 'head' },
        );
      }
      // Getirilen commit bir ref'e bağlanır: önbellekte çöp toplama silmesin.
      await runGit(dir, ['update-ref', `refs/reviewist/sha/${headSha}`, headSha]);
    } else {
      headSha = headDst !== undefined ? await localCommit(dir, headDst) : undefined;
      if (headSha === undefined) {
        throw new SourceError(`İncelenecek dal getirilemedi: '${headLabel}'.`, { status: 502, code: 'GIT_FAILED', field: 'head' });
      }
    }
    return { baseName, headLabel, baseSha, headSha };
  });

  // Ortak git kaynağı SHA'larla çağrılır (kilit bırakıldıktan sonra başka bir getirme ref'leri değiştirse de tutarlı).
  const toHuman = (s: string): string =>
    s.split(fetched.baseSha).join(fetched.baseName).split(fetched.headSha).join(fetched.headLabel);
  const cs = await createGitChangeSet({
    repoPath: dir,
    base: fetched.baseSha,
    head: fetched.headSha,
    mode: 'mergeBase',
    onProgress: (m) => progress(toHuman(m)),
  });

  const n = remote.prNumber;
  const prInfo = pr;
  const info: ReviewSourceInfo = {
    kind: 'github',
    title:
      n !== undefined
        ? prInfo
          ? `#${n}: ${prInfo.title}`
          : `${repoName}#${n}`
        : `${repoName}: ${fetched.baseName}...${fetched.headLabel}`,
    baseRef: fetched.baseName,
    headRef: fetched.headLabel,
    stableKey:
      n !== undefined
        ? githubStableKey(remote.host, remote.owner, remote.repo, n)
        : `github:${remote.host.toLowerCase()}/${remote.owner.toLowerCase()}/${remote.repo.toLowerCase()}:${fetched.baseName}...${fetched.headLabel}`,
  };
  if (cs.info.baseSha !== undefined) info.baseSha = cs.info.baseSha;
  if (cs.info.headSha !== undefined) info.headSha = cs.info.headSha;
  if (n !== undefined) {
    info.prNumber = n;
    info.prUrl = prInfo?.htmlUrl ?? remote.webUrl;
    if (prInfo?.author) info.author = prInfo.author;
    if (prInfo?.body) info.description = prInfo.body;
    if (prInfo && head === undefined && prInfo.headSha.toLowerCase() !== fetched.headSha) {
      warnings.push(
        `PR güncellenmiş olabilir: GitHub API'ye göre PR başı ${prInfo.headSha.slice(0, 10)}, getirilen commit ${fetched.headSha.slice(0, 10)}. Güncel hali için incelemeyi yenileyin.`,
      );
    }
  }
  cs.info = info;
  const own = cs.warnings.map(toHuman);
  cs.warnings.length = 0;
  cs.warnings.push(...warnings, ...own);
  return cs;
}

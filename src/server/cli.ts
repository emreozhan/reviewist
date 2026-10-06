/**
 * `reviewist` komutu: yerel API sunucusunu (ve derlenmişse arayüzü) 127.0.0.1 üzerinde açar.
 * base/head, --worktree ya da --pr verilirse sunucu açıldıktan sonra ilk review iş (job) altyapısıyla hazırlanır,
 * ilerleme konsola yazılır; tarayıcı review hazır olunca açılır.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { ApiError, ReviewJob, ReviewRequest } from '../shared/types.js';
import { isSourceError, shortMessage } from '../sources/errors.js';
import { getGitRefs, resolveRepoRoot } from '../sources/git.js';
import { DEFAULT_TOKEN_ENVS } from '../sources/github.js';
import { createApp } from './app.js';
import { CliUsageError, HELP_TEXT, parseCliArgs, type CliOptions } from './cliOptions.js';
import { openBrowser } from './openBrowser.js';

// Windows: alt süreç başlatılırken çalışma dizini (incelenen depo olabilir) çalıştırılabilir dosya aramasına katılmasın.
// Komutlar zaten mutlak yolla çağrılır; bu ek bir güvencedir.
process.env.NoDefaultCurrentDirectoryInExePath = '1';

const here = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  let dir = here;
  for (let i = 0; i < 5; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg && typeof pkg === 'object' && 'name' in pkg && pkg.name === 'reviewist' && 'version' in pkg) {
          return String(pkg.version);
        }
      } catch {
        /* bozuk package.json: üst dizine devam */
      }
    }
    dir = dirname(dir);
  }
  return '0.0.0';
}

/**
 * Önceki çalıştırmalardan kalmış geçici klasörleri (ör. terminal kapatılınca silinemeyen GitHub arşivleri) temizler.
 * Yalnız Reviewist'in kendi önekleri ve bir günden eski olanlar; hata sessizce yok sayılır.
 */
function sweepStaleTempDirs(): void {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const prefixes = ['reviewist-gh-', 'reviewist-nohooks-', 'reviewist-smoke-'];
  try {
    const base = tmpdir();
    for (const name of readdirSync(base)) {
      if (!prefixes.some((p) => name.startsWith(p))) continue;
      const full = join(base, name);
      try {
        if (Date.now() - statSync(full).mtimeMs > maxAgeMs) rmSync(full, { recursive: true, force: true });
      } catch {
        /* başka bir süreç kullanıyor olabilir */
      }
    }
  } catch {
    /* tmpdir okunamadı */
  }
}

/** Paketlenmiş halde `dist/server/cli.js` → `dist/web`. Geliştirme (tsx) modunda arayüzü Vite sunar; yok sayılır. */
function findStaticDir(): string | undefined {
  if (/\.ts$/.test(fileURLToPath(import.meta.url))) return undefined;
  const candidate = resolve(here, '../web');
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined;
}

function formatApiError(e: ApiError): string {
  let out = e.error;
  if (e.field) out += `\n  Alan: ${e.field}`;
  if (e.detail) out += `\n  Ayrıntı: ${e.detail}`;
  return out;
}

function formatError(err: unknown): string {
  if (isSourceError(err)) return formatApiError({ error: err.message, detail: err.detail, field: err.field });
  return shortMessage(err, 500);
}

async function initialRequest(opts: CliOptions, repoRoot: string | undefined): Promise<ReviewRequest | undefined> {
  if (opts.pr) return { kind: 'github', url: opts.pr, localRepoPath: repoRoot };
  if (!opts.worktree && !opts.base && !opts.head) return undefined;
  if (!repoRoot) throw new CliUsageError('Bir git deposu içinde çalıştırın ya da depo yolunu verin.');
  if (opts.worktree) return { kind: 'worktree', repoPath: repoRoot, base: opts.base ?? 'HEAD', includeUntracked: true };
  let base = opts.base;
  if (!base) {
    base = (await getGitRefs(repoRoot)).defaultBase;
    if (!base) throw new CliUsageError('Taban dal bulunamadı (origin/HEAD, main, master, develop yok); --base verin.');
    console.log(`Taban dal: ${base}`);
  }
  return { kind: 'git', repoPath: repoRoot, base, head: opts.head ?? 'HEAD', mode: 'mergeBase' };
}

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${HELP_TEXT}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP_TEXT);
    return;
  }

  const version = readVersion();
  sweepStaleTempDirs();
  const repoArg = resolve(opts.repoPath ?? process.cwd());
  let repoRoot: string | undefined;
  try {
    repoRoot = await resolveRepoRoot(repoArg);
  } catch (err) {
    const needsRepo = opts.repoPath !== undefined || opts.worktree || opts.base !== undefined || opts.head !== undefined;
    if (needsRepo) {
      console.error(`Hata: ${formatError(err)}`);
      process.exit(1);
    }
    // Depo dışında başlatıldı: arayüzden depo yolu ya da PR adresi girilebilir.
  }

  const tokenEnvNames = opts.tokenEnv ? [opts.tokenEnv, ...DEFAULT_TOKEN_ENVS] : [...DEFAULT_TOKEN_ENVS];
  if (opts.tokenEnv && !process.env[opts.tokenEnv]) {
    console.warn(`Uyarı: ${opts.tokenEnv} ortam değişkeni tanımlı değil.`);
  }

  const staticDir = findStaticDir();
  const reviewist = createApp({
    defaultRepoPath: repoRoot,
    staticDir,
    version,
    tokenEnvNames,
    onProgress: (msg) => console.log(`  · ${msg}`),
  });

  let req: ReviewRequest | undefined;
  try {
    req = await initialRequest(opts, repoRoot);
  } catch (err) {
    console.error(`Hata: ${formatError(err)}`);
    await reviewist.dispose();
    process.exit(1);
  }

  // Sunucu önce açılır: port sorunu uzun analizden önce fark edilir.
  const hostForUrl = opts.host === '::1' ? '[::1]' : opts.host;
  const url = `http://${hostForUrl}:${opts.port}/`;
  let server: ReturnType<typeof serve>;
  try {
    server = await listen(reviewist.app.fetch, opts.port, opts.host);
  } catch (err) {
    console.error(listenErrorMessage(err, opts.port));
    await reviewist.dispose();
    process.exit(1);
  }

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    console.log('\nKapatılıyor…');
    void reviewist.dispose();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (req) {
    const label = req.kind === 'github' ? req.url : req.kind === 'git' ? `${req.base}...${req.head}` : 'çalışma ağacı';
    console.log(`İlk review hazırlanıyor: ${label}`);
    const t0 = Date.now();
    let job: ReviewJob | undefined;
    try {
      job = await reviewist.waitForJob(reviewist.startJob(req).id);
    } catch (err) {
      console.error(`Hata: ${formatError(err)}`);
    }
    const model = job?.status === 'done' && job.reviewId ? reviewist.getReview(job.reviewId) : undefined;
    if (!model) {
      if (job?.error) console.error(`Hata: ${formatApiError(job.error)}`);
      closing = true;
      await reviewist.dispose();
      server.close();
      process.exit(1);
    }
    reviewist.setInitialReviewId(model.id);
    console.log(
      `Review hazır (${model.id}): ${model.files.length} dosya, ${model.warnings.length} uyarı, ${Date.now() - t0} ms`,
    );
    for (const w of model.warnings.slice(0, 5)) console.log(`  ! ${w}`);
    if (model.warnings.length > 5) console.log(`  ! … ve ${model.warnings.length - 5} uyarı daha (arayüzde)`);
  }

  console.log(`Reviewist ${version} çalışıyor: ${url}`);
  if (repoRoot) console.log(`Depo: ${repoRoot}`);
  if (!staticDir) {
    console.log('Yalnızca API modu (derlenmiş arayüz yok). Arayüz için `npm run dev:web` çalıştırın (http://localhost:5173).');
  } else if (opts.open) {
    openBrowser(url).catch((err: unknown) => console.warn(`Tarayıcı açılamadı (${shortMessage(err, 120)}). Adresi elle açın: ${url}`));
  }
  console.log('Durdurmak için Ctrl+C.');
}

/** Sunucuyu açar; dinlemeye başlayınca ya da hata olunca çözülür. */
function listen(
  fetch: Parameters<typeof serve>[0]['fetch'],
  port: number,
  hostname: string,
): Promise<ReturnType<typeof serve>> {
  return new Promise((resolveListen, rejectListen) => {
    const server = serve({ fetch, port, hostname }, () => resolveListen(server));
    server.once('error', (err: Error) => rejectListen(err));
  });
}

function listenErrorMessage(err: unknown, port: number): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EADDRINUSE') return `Port ${port} kullanımda. Başka bir port seçin: --port ${port + 1}`;
  if (code === 'EACCES') return `Port ${port} için izin yok. 1024 üstü bir port seçin.`;
  return `Sunucu başlatılamadı: ${shortMessage(err, 200)}`;
}

main().catch((err: unknown) => {
  console.error(`Hata: ${formatError(err)}`);
  process.exit(1);
});

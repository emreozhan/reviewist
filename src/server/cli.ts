/**
 * `reviewist` komutu: yerel API sunucusunu (ve derlenmişse arayüzü) 127.0.0.1 üzerinde açar.
 * base/head, --worktree ya da --pr verilirse sunucu açılmadan önce ilk review hazırlanır.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import open from 'open';
import type { ReviewRequest } from '../shared/types.js';
import { isSourceError, shortMessage } from '../sources/errors.js';
import { getGitRefs, resolveRepoRoot } from '../sources/git.js';
import { DEFAULT_TOKEN_ENVS } from '../sources/github.js';
import { createApp } from './app.js';
import { CliUsageError, HELP_TEXT, parseCliArgs, type CliOptions } from './cliOptions.js';

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

/** Derlenmiş halde `dist/server/server/cli.js` → `dist/web`. Geliştirme (tsx) modunda yok sayılır. */
function findStaticDir(): string | undefined {
  const candidate = resolve(here, '../../web');
  if (basename(dirname(candidate)) === 'dist' && existsSync(join(candidate, 'index.html'))) return candidate;
  return undefined;
}

function formatError(err: unknown): string {
  if (isSourceError(err)) return err.detail ? `${err.message}\n  Ayrıntı: ${err.detail}` : err.message;
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
    if (req) {
      const label = req.kind === 'github' ? req.url : req.kind === 'git' ? `${req.base}...${req.head}` : 'çalışma ağacı';
      console.log(`İlk review hazırlanıyor: ${label}`);
      const t0 = Date.now();
      const model = await reviewist.createReview(req);
      reviewist.setInitialReviewId(model.id);
      console.log(
        `Review hazır (${model.id}): ${model.files.length} dosya, ${model.warnings.length} uyarı, ${Date.now() - t0} ms`,
      );
      for (const w of model.warnings.slice(0, 5)) console.log(`  ! ${w}`);
    }
  } catch (err) {
    console.error(`Hata: ${formatError(err)}`);
    await reviewist.dispose();
    process.exit(1);
  }

  const hostForUrl = opts.host === '::1' ? '[::1]' : opts.host;
  const url = `http://${hostForUrl}:${opts.port}/`;
  const server = serve({ fetch: reviewist.app.fetch, port: opts.port, hostname: opts.host }, () => {
    console.log(`Reviewist ${version} çalışıyor: ${url}`);
    if (repoRoot) console.log(`Depo: ${repoRoot}`);
    if (!staticDir) {
      console.log('Yalnızca API modu (derlenmiş arayüz yok). Arayüz için `npm run dev:web` çalıştırın (http://localhost:5173).');
    } else if (opts.open) {
      open(url).catch((err: unknown) => console.warn(`Tarayıcı açılamadı: ${shortMessage(err, 120)}`));
    }
    console.log('Durdurmak için Ctrl+C.');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${opts.port} kullanımda. Başka bir port seçin: --port ${opts.port + 1}`);
    } else if (err.code === 'EACCES') {
      console.error(`Port ${opts.port} için izin yok. 1024 üstü bir port seçin.`);
    } else {
      console.error(`Sunucu başlatılamadı: ${shortMessage(err, 200)}`);
    }
    void reviewist.dispose().finally(() => process.exit(1));
  });

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    console.log('\nKapatılıyor…');
    reviewist.dispose();
    server.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(`Hata: ${formatError(err)}`);
  process.exit(1);
});

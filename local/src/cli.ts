/**
 * Reviewist Yerel: yerel git depolarını inceler (git aralığı, çalışma ağacı, patch). Ağa hiç çıkmaz:
 * bu paket ağ kodu içermez (derleme bunu denetler), çıkış bekçisinin izin listesi boştur ve git'in ağ taşıyıcıları
 * kapalıdır.
 */
import { resolve } from 'node:path';
import type { ReviewRequest } from '../../shared/src/shared/types.js';
import { disableGitNetwork, getGitRefs, resolveRepoRoot } from '../../shared/src/sources/git.js';
import { formatError, runServer } from '../../shared/src/server/runServer.js';
import { CliUsageError, HELP_TEXT, parseCliArgs, type CliOptions } from './cliOptions.js';

async function initialRequest(opts: CliOptions, repoRoot: string | undefined): Promise<ReviewRequest | undefined> {
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

  disableGitNetwork();

  let repoRoot: string | undefined;
  try {
    repoRoot = await resolveRepoRoot(resolve(opts.repoPath ?? process.cwd()));
  } catch (err) {
    const needsRepo = opts.repoPath !== undefined || opts.worktree || opts.base !== undefined || opts.head !== undefined;
    if (needsRepo) {
      console.error(`Hata: ${formatError(err)}`);
      process.exit(1);
    }
    // Depo dışında başlatıldı: depo klasörü arayüzden seçilir.
  }

  let request: ReviewRequest | undefined;
  try {
    request = await initialRequest(opts, repoRoot);
  } catch (err) {
    console.error(`Hata: ${formatError(err)}`);
    process.exit(1);
  }
  const label = request?.kind === 'git' ? `${request.base}...${request.head}` : 'çalışma ağacı';

  await runServer({
    appName: 'Reviewist Yerel',
    port: opts.port,
    host: opts.host,
    open: opts.open,
    app: { edition: 'local', defaultRepoPath: repoRoot },
    // allowHosts verilmez: süreç ağa hiç çıkamaz.
    initial: request ? { request, label } : undefined,
    info: repoRoot ? [`Depo: ${repoRoot}`] : [],
  });
}

main().catch((err: unknown) => {
  console.error(`Hata: ${formatError(err)}`);
  process.exit(1);
});

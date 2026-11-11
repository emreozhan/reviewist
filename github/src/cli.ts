/**
 * Reviewist GitHub: uzak depoları inceler. Depo git ile yerel önbelleğe getirilir; PR başlığı/taban dalı için tek bir
 * GitHub API isteği yapılır. Süreç içi çıkış bekçisi yalnız GitHub API sunucularına izin verir (git alt süreci kendi
 * bağlantısını kurar).
 */
import { mkdirSync } from 'node:fs';
import type { GithubReviewRequest } from '../../shared/src/shared/types.js';
import { SourceError } from '../../shared/src/sources/errors.js';
import { formatError, runServer } from '../../shared/src/server/runServer.js';
import { resolveCacheDir } from './cache.js';
import { HELP_TEXT, parseGithubCliArgs, type GithubCliOptions } from './cliOptions.js';
import { parseGithubRequest } from './request.js';
import { createGithubChangeSet } from './source.js';
import { apiHostsAllowed, DEFAULT_TOKEN_ENVS, githubTokenConfigured } from './token.js';

async function main(): Promise<void> {
  let opts: GithubCliOptions;
  try {
    opts = parseGithubCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${HELP_TEXT}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP_TEXT);
    return;
  }

  const cacheDir = resolveCacheDir(opts.cacheDir);
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch (err) {
    console.error(`Hata: önbellek klasörü oluşturulamadı: ${cacheDir} (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  }
  const tokenEnvNames: readonly string[] = opts.tokenEnvNames ?? DEFAULT_TOKEN_ENVS;

  let request: GithubReviewRequest | undefined;
  if (opts.url) {
    try {
      request = parseGithubRequest({ kind: 'github', url: opts.url, base: opts.base, head: opts.head });
    } catch (err) {
      console.error(`Hata: ${formatError(err)}`);
      process.exit(1);
    }
  }

  await runServer({
    appName: 'Reviewist GitHub',
    port: opts.port,
    host: opts.host,
    open: opts.open,
    app: {
      edition: 'github',
      parseRequest: parseGithubRequest,
      createChangeSet: async (req, o) => {
        if (req.kind !== 'github') {
          throw new SourceError("Bu uygulama yalnız uzak (GitHub) depoları inceler; yerel depolar için Reviewist Yerel'i kullanın.", {
            status: 400,
            code: 'VALIDATION',
            field: 'kind',
          });
        }
        return await createGithubChangeSet({
          url: req.url,
          base: req.base,
          head: req.head,
          cacheDir,
          tokenEnvNames,
          onProgress: o.onProgress,
        });
      },
      configExtras: () => ({ githubTokenConfigured: githubTokenConfigured(tokenEnvNames), cacheDir }),
    },
    allowHosts: () => apiHostsAllowed(),
    initial: request ? { request, label: request.url } : undefined,
    info: [`Önbellek: ${cacheDir}`],
  });
}

main().catch((err: unknown) => {
  console.error(`Hata: ${formatError(err)}`);
  process.exit(1);
});

/**
 * `reviewist` komut satırı argümanlarının ayrıştırılması (yan etkisiz; test edilebilir).
 */
import { parseArgs } from 'node:util';

export interface CliOptions {
  repoPath?: string;
  base?: string;
  head?: string;
  worktree: boolean;
  pr?: string;
  tokenEnv?: string;
  port: number;
  host: string;
  open: boolean;
  help: boolean;
}

export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const HELP_TEXT = `Reviewist — Java değişiklikleri için yerel review aracı

Kullanım:
  reviewist [repoPath] [seçenekler]

Seçenekler:
  --base <ref>        Taban dal/commit (varsayılan: origin/HEAD, main, master, develop)
  --head <ref>        İncelenecek dal/commit (varsayılan: HEAD)
  --worktree          Çalışma ağacındaki (commitlenmemiş) değişiklikleri incele (--base varsayılanı HEAD)
  --pr <url>          GitHub PR adresi (https://github.com/sahip/depo/pull/123)
  --token-env <AD>    GitHub token'ının okunacağı ortam değişkeni (varsayılan GITHUB_TOKEN, GH_TOKEN)
  --port <n>          Sunucu portu (varsayılan ${DEFAULT_PORT})
  --host <adres>      Bağlanılacak adres; yalnız loopback (varsayılan ${DEFAULT_HOST})
  --no-open           Tarayıcıyı otomatik açma
  --help              Bu yardımı göster

Örnekler:
  reviewist . --base main --head feature/x
  reviewist --worktree
  reviewist --pr https://github.com/acme/shop/pull/42
`;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

function rawParse(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      worktree: { type: 'boolean' },
      pr: { type: 'string' },
      'token-env': { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  });
}

export function parseCliArgs(argv: string[]): CliOptions {
  let parsed: ReturnType<typeof rawParse>;
  try {
    parsed = rawParse(argv);
  } catch (err) {
    throw new CliUsageError(`Geçersiz argüman: ${err instanceof Error ? err.message : String(err)}`);
  }
  const v = parsed.values;
  if (parsed.positionals.length > 1) {
    throw new CliUsageError(`Yalnızca bir depo yolu verilebilir; fazladan: ${parsed.positionals.slice(1).join(' ')}`);
  }
  const portRaw = v.port ?? String(DEFAULT_PORT);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliUsageError(`--port 1-65535 arasında bir tam sayı olmalı: '${portRaw}'`);
  }
  const host = v.host ?? DEFAULT_HOST;
  if (!LOOPBACK.has(host.toLowerCase())) {
    throw new CliUsageError(
      `Güvenlik nedeniyle yalnızca yerel adrese bağlanılabilir (127.0.0.1, localhost, ::1); verilen: '${host}'`,
    );
  }
  if (v.pr && v.worktree) throw new CliUsageError('--pr ile --worktree birlikte kullanılamaz.');
  if (v.pr && (v.base || v.head)) throw new CliUsageError('--pr ile --base/--head birlikte kullanılamaz.');
  if (v.worktree && v.head) throw new CliUsageError('--worktree ile --head birlikte kullanılamaz (head çalışma ağacıdır).');
  const tokenEnv = v['token-env'];
  if (tokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) {
    throw new CliUsageError(`--token-env geçerli bir ortam değişkeni adı olmalı: '${tokenEnv}'`);
  }
  return {
    repoPath: parsed.positionals[0],
    base: v.base,
    head: v.head,
    worktree: v.worktree ?? false,
    pr: v.pr,
    tokenEnv,
    port,
    host: host === '[::1]' ? '::1' : host,
    open: !(v['no-open'] ?? false),
    help: v.help ?? false,
  };
}

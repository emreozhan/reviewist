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

  repoPath verilmezse geçerli klasörün git deposu kullanılır. --base, --head, --worktree ya da --pr
  verilirse ilk review sunucu açılınca hazırlanır (ilerleme konsola yazılır), sonra tarayıcı açılır.
  Hiçbiri verilmezse yalnız sunucu açılır; review arayüzden başlatılır.

Seçenekler:
  --base <ref>        Taban dal/etiket/commit (varsayılan: origin/HEAD, yoksa main, master, develop)
  --head <ref>        İncelenecek dal/etiket/commit (varsayılan: HEAD). base ile head'in ortak
                      atasından (merge-base) itibaren karşılaştırılır (PR görünümü)
  --worktree          Çalışma ağacındaki commitlenmemiş değişiklikleri (izlenmeyen dosyalar dahil)
                      incele; --base varsayılanı HEAD. --head ile birlikte kullanılamaz
  --pr <url>          GitHub PR adresi (https://github.com/sahip/depo/pull/123 ya da sahip/depo#123).
                      Klasör o PR'ın deposuysa PR yerel git ile getirilir, değilse GitHub API kullanılır
  --token-env <AD>    GitHub token'ının okunacağı ortam değişkeni (bundan sonra GITHUB_TOKEN, GH_TOKEN
                      denenir). Token komut satırında verilmez
  --port <n>          Sunucu portu (varsayılan ${DEFAULT_PORT})
  --host <adres>      Bağlanılacak adres; yalnız 127.0.0.1, localhost ya da ::1 (varsayılan ${DEFAULT_HOST})
  --no-open           Tarayıcıyı otomatik açma
  -h, --help          Bu yardımı göster

Örnekler:
  reviewist                                     Sunucuyu aç, review'u arayüzden başlat
  reviewist . --base main --head feature/x      İki dalı karşılaştır
  reviewist ../shop --base main                 Başka bir depoda HEAD'i main ile karşılaştır
  reviewist --worktree                          Commitlenmemiş değişiklikleri incele
  reviewist --pr https://github.com/acme/shop/pull/42 --token-env IS_TOKENI
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

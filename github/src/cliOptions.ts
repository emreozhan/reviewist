/**
 * `reviewist-github` komut satırı argümanlarının ayrıştırılması (yan etkisiz; test edilebilir).
 */
import { parseArgs } from 'node:util';
import { CliUsageError, parsePortAndHost } from '../../local/src/cliOptions.js';

export { CliUsageError };

export interface GithubCliOptions {
  /** PR ya da depo adresi; verilirse ilk inceleme açılışta hazırlanır. */
  url?: string;
  base?: string;
  head?: string;
  /** Token için bakılacak ortam değişkeni adları (verilmezse GITHUB_TOKEN, GH_TOKEN). */
  tokenEnvNames?: string[];
  cacheDir?: string;
  port: number;
  host: string;
  open: boolean;
  help: boolean;
}

export const DEFAULT_PORT = 4318;

export const HELP_TEXT = `Reviewist GitHub — uzak depolardaki Java değişikliklerini inceler
Depo git ile yerel önbelleğe getirilir (git clone/fetch); PR başlığı ve taban dalı için tek bir GitHub API isteği yapılır.

Kullanım:
  reviewist-github [adres] [seçenekler]

  adres verilirse ilk inceleme sunucu açılınca hazırlanır (ilerleme konsola yazılır), sonra tarayıcı açılır.
  Verilmezse yalnız sunucu açılır; adres arayüzden girilir.

Adres biçimleri:
  https://github.com/sahip/depo/pull/12     PR (GitHub Enterprise: https://sunucu/sahip/depo/pull/12)
  sahip/depo#12                              github.com'daki PR (kısa)
  https://github.com/sahip/depo              Depo (--head zorunlu)
  git@github.com:sahip/depo.git              Depo, SSH ile
  sahip/depo                                 github.com'daki depo (kısa)

Seçenekler:
  --base <dal>          Taban dal (PR'da varsayılan PR'ın hedef dalı; depoda uzak varsayılan dal)
  --head <dal|etiket|sha>
                        İncelenecek dal, etiket ya da commit (depo adresinde zorunlu; PR'da PR başının yerine geçer)
  --token-env <AD>      PR bilgisi için token'ın okunacağı ortam değişkeni (varsayılan GITHUB_TOKEN, sonra GH_TOKEN;
                        birden çok kez verilebilir). Token yalnız github.com ve REVIEWIST_GITHUB_HOSTS sunucularına gider
  --cache-dir <yol>     Klon önbelleği (varsayılan REVIEWIST_CACHE_DIR ya da işletim sisteminin önbellek klasörü)
  --port <n>            Sunucu portu (varsayılan ${DEFAULT_PORT})
  --host <adres>        Bağlanılacak adres; yalnız 127.0.0.1, localhost ya da ::1 (varsayılan 127.0.0.1)
  --no-open             Tarayıcıyı otomatik açma
  -h, --help            Bu yardımı göster

Kimlik doğrulama:
  Kod git ile getirilir; özel depolar için git'in erişimi olmalı (credential helper ya da SSH anahtarı).
  Denemek için: git ls-remote <adres>. SSH tercih ediyorsanız REVIEWIST_GIT_PROTOCOL=ssh ayarlayın.

Örnekler:
  reviewist-github                                              Sunucuyu aç, adresi arayüzden gir
  reviewist-github https://github.com/sahip/depo/pull/12        Bir PR'ı incele
  reviewist-github sahip/depo --base main --head feature/x      İki dalı karşılaştır
  reviewist-github git@github.com:sahip/depo.git --head v2.0    main...v2.0 (taban: varsayılan dal)

Yerel depolar için ayrı uygulamayı kullanın: reviewist-local
`;

function rawParse(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      'token-env': { type: 'string', multiple: true },
      'cache-dir': { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  });
}

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseGithubCliArgs(argv: string[]): GithubCliOptions {
  let parsed: ReturnType<typeof rawParse>;
  try {
    parsed = rawParse(argv);
  } catch (err) {
    throw new CliUsageError(`Geçersiz argüman: ${err instanceof Error ? err.message : String(err)}`);
  }
  const v = parsed.values;
  if (parsed.positionals.length > 1) {
    throw new CliUsageError(`Yalnızca bir adres verilebilir; fazladan: ${parsed.positionals.slice(1).join(' ')}`);
  }
  const { port, host } = parsePortAndHost(v.port, v.host, DEFAULT_PORT);
  const url = parsed.positionals[0]?.trim() || undefined;
  if (!url && (v.base !== undefined || v.head !== undefined)) {
    throw new CliUsageError('--base / --head yalnız bir adresle birlikte kullanılabilir.');
  }
  const tokenEnvNames = v['token-env']?.map((s) => s.trim());
  for (const name of tokenEnvNames ?? []) {
    if (!ENV_NAME_RE.test(name)) throw new CliUsageError(`--token-env geçerli bir ortam değişkeni adı olmalı: '${name}'`);
  }
  const cacheDir = v['cache-dir']?.trim();
  if (v['cache-dir'] !== undefined && !cacheDir) throw new CliUsageError('--cache-dir boş olamaz.');
  const out: GithubCliOptions = { port, host, open: !(v['no-open'] ?? false), help: v.help ?? false };
  if (url) out.url = url;
  if (v.base !== undefined) out.base = v.base;
  if (v.head !== undefined) out.head = v.head;
  if (tokenEnvNames && tokenEnvNames.length > 0) out.tokenEnvNames = tokenEnvNames;
  if (cacheDir) out.cacheDir = cacheDir;
  return out;
}

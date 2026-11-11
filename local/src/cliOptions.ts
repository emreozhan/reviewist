/**
 * `reviewist-local` komut satırı argümanlarının ayrıştırılması (yan etkisiz; test edilebilir).
 */
import { parseArgs } from 'node:util';

export interface CliOptions {
  repoPath?: string;
  base?: string;
  head?: string;
  worktree: boolean;
  port: number;
  host: string;
  open: boolean;
  help: boolean;
}

export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const HELP_TEXT = `Reviewist Yerel — yerel git depolarındaki Java değişikliklerini inceler (ağa çıkmaz)

Kullanım:
  reviewist-local [depoYolu] [seçenekler]

  depoYolu verilmezse geçerli klasörün git deposu kullanılır. --base, --head ya da --worktree verilirse ilk inceleme
  sunucu açılınca hazırlanır (ilerleme konsola yazılır), sonra tarayıcı açılır. Hiçbiri verilmezse yalnız sunucu
  açılır; inceleme arayüzden başlatılır (depo klasörü ve dallar oradan seçilir).

Seçenekler:
  --base <ref>        Taban dal/etiket/commit (varsayılan: origin/HEAD, yoksa main, master, develop)
  --head <ref>        İncelenecek dal/etiket/commit (varsayılan: HEAD). base ile head'in ortak
                      atasından (merge-base) itibaren karşılaştırılır (PR görünümü)
  --worktree          Çalışma ağacındaki commitlenmemiş değişiklikleri (izlenmeyen dosyalar dahil)
                      incele; --base varsayılanı HEAD. --head ile birlikte kullanılamaz
  --port <n>          Sunucu portu (varsayılan ${DEFAULT_PORT})
  --host <adres>      Bağlanılacak adres; yalnız 127.0.0.1, localhost ya da ::1 (varsayılan ${DEFAULT_HOST})
  --no-open           Tarayıcıyı otomatik açma
  -h, --help          Bu yardımı göster

Örnekler:
  reviewist-local                                   Sunucuyu aç, incelemeyi arayüzden başlat
  reviewist-local . --base main --head feature/x    İki dalı karşılaştır
  reviewist-local ../shop --base main               Başka bir depoda HEAD'i main ile karşılaştır
  reviewist-local --worktree                        Commitlenmemiş değişiklikleri incele

Uzak (GitHub) depoları için ayrı uygulamayı kullanın: reviewist-github
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
      port: { type: 'string' },
      host: { type: 'string' },
      'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  });
}

/** `--port` ve `--host` değerlerini doğrular (iki uygulama ortak kullanır). */
export function parsePortAndHost(portRaw: string | undefined, hostRaw: string | undefined, defaultPort: number): { port: number; host: string } {
  const raw = portRaw ?? String(defaultPort);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliUsageError(`--port 1-65535 arasında bir tam sayı olmalı: '${raw}'`);
  }
  const host = hostRaw ?? DEFAULT_HOST;
  if (!LOOPBACK.has(host.toLowerCase())) {
    throw new CliUsageError(
      `Güvenlik nedeniyle yalnızca yerel adrese bağlanılabilir (127.0.0.1, localhost, ::1); verilen: '${host}'`,
    );
  }
  return { port, host: host === '[::1]' ? '::1' : host };
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
  const { port, host } = parsePortAndHost(v.port, v.host, DEFAULT_PORT);
  if (v.worktree && v.head) throw new CliUsageError('--worktree ile --head birlikte kullanılamaz (head çalışma ağacıdır).');
  return {
    repoPath: parsed.positionals[0],
    base: v.base,
    head: v.head,
    worktree: v.worktree ?? false,
    port,
    host,
    open: !(v['no-open'] ?? false),
    help: v.help ?? false,
  };
}

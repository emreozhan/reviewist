/**
 * Sunucu başlatıcı: iki uygulamanın (local/, github/) komut satırı girişleri bunu çağırır. API sunucusunu (ve
 * derlenmişse arayüzü) yalnız loopback üzerinde açar, çıkış bekçisini kurar; ilk inceleme isteği verildiyse onu iş
 * altyapısıyla hazırlar, ilerlemeyi konsola yazar ve tarayıcıyı inceleme hazır olunca açar.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { ApiError, ReviewJob, ReviewRequest } from '../shared/types.js';
import { isSourceError, shortMessage } from '../sources/errors.js';
import { createApp, type CreateAppOptions } from './app.js';
import { installEgressGuard } from '../runtime/egressGuard.js';
import { openBrowser } from './openBrowser.js';

/** Derleme sırasında gömülen sürüm (bkz. scripts/build.mjs); kaynaktan çalışırken tanımsızdır. */
declare const __REVIEWIST_VERSION__: string | undefined;

const here = dirname(fileURLToPath(import.meta.url));

export function readVersion(): string {
  if (typeof __REVIEWIST_VERSION__ === 'string') return __REVIEWIST_VERSION__;
  let dir = here;
  for (let i = 0; i < 6; i++) {
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
 * Önceki çalıştırmalardan kalmış geçici klasörleri (ör. terminal kapatılınca silinemeyenler) temizler.
 * Yalnız Reviewist'in kendi önekleri ve bir günden eski olanlar; hata sessizce yok sayılır.
 */
function sweepStaleTempDirs(): void {
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const prefixes = ['reviewist-nohooks-', 'reviewist-smoke-'];
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

export function formatApiError(e: ApiError): string {
  let out = e.error;
  if (e.field) out += `\n  Alan: ${e.field}`;
  if (e.detail) out += `\n  Ayrıntı: ${e.detail}`;
  return out;
}

export function formatError(err: unknown): string {
  if (isSourceError(err)) return formatApiError({ error: err.message, detail: err.detail, field: err.field });
  return shortMessage(err, 500);
}

export interface RunServerOptions {
  /** Konsolda görünen uygulama adı (ör. 'Reviewist Yerel'). */
  appName: string;
  port: number;
  host: string;
  /** Sunucu hazır olunca tarayıcı açılsın mı. */
  open: boolean;
  /** Uygulamaya özel API seçenekleri (edition, istek doğrulayıcı, kaynak üreticisi…). */
  app: Omit<CreateAppOptions, 'staticDir' | 'version' | 'onProgress'>;
  /** Çıkış bekçisinin izin vereceği sunucu adları. Verilmezse süreç ağa hiç çıkamaz. */
  allowHosts?: () => Iterable<string>;
  /** Sunucu açılınca hazırlanacak ilk inceleme ve konsoldaki etiketi. */
  initial?: { request: ReviewRequest; label: string };
  /** Açılışta yazdırılacak ek bilgi satırları (ör. 'Depo: …'). */
  info?: string[];
}

/** Sunucuyu başlatır; süreç Ctrl+C ile kapanana kadar çalışır. Başlatma hatasında süreçten çıkar. */
export async function runServer(o: RunServerOptions): Promise<void> {
  // Windows: alt süreç başlatılırken çalışma dizini (incelenen depo olabilir) çalıştırılabilir dosya aramasına katılmasın.
  // Komutlar zaten mutlak yolla çağrılır; bu ek bir güvencedir.
  process.env.NoDefaultCurrentDirectoryInExePath = '1';
  installEgressGuard({ allowHosts: o.allowHosts });

  const version = readVersion();
  sweepStaleTempDirs();
  const staticDir = findStaticDir();
  const reviewist = createApp({
    ...o.app,
    staticDir,
    version,
    onProgress: (msg) => console.log(`  · ${msg}`),
  });

  // Sunucu önce açılır: port sorunu uzun analizden önce fark edilir.
  const hostForUrl = o.host === '::1' ? '[::1]' : o.host;
  const url = `http://${hostForUrl}:${o.port}/`;
  let server: ReturnType<typeof serve>;
  try {
    server = await listen(reviewist.app.fetch, o.port, o.host);
  } catch (err) {
    console.error(listenErrorMessage(err, o.port));
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

  if (o.initial) {
    console.log(`İlk inceleme hazırlanıyor: ${o.initial.label}`);
    const t0 = Date.now();
    let job: ReviewJob | undefined;
    try {
      job = await reviewist.waitForJob(reviewist.startJob(o.initial.request).id);
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
    console.log(`İnceleme hazır (${model.id}): ${model.files.length} dosya, ${model.warnings.length} uyarı, ${Date.now() - t0} ms`);
    for (const w of model.warnings.slice(0, 5)) console.log(`  ! ${w}`);
    if (model.warnings.length > 5) console.log(`  ! … ve ${model.warnings.length - 5} uyarı daha (arayüzde)`);
  }

  console.log(`${o.appName} ${version} çalışıyor: ${url}`);
  for (const line of o.info ?? []) console.log(line);
  if (!staticDir) {
    console.log('Yalnızca API modu (derlenmiş arayüz yok). Arayüz için Vite geliştirme sunucusunu çalıştırın (http://localhost:5173).');
  } else if (o.open) {
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

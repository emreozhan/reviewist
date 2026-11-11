/**
 * Paralel Java ayrıştırma havuzu (node:worker_threads) + içerik anahtarlı LRU önbellek.
 *
 * - `parseJavaFiles(items, opts)`: sonuçlar girdi sırasıyla döner. Önbellekte olmayan dosya sayısı küçükse (< 40) ya da
 *   işçi başlatılamazsa ana thread'de ayrıştırır. Havuz süreç ömrü boyunca yeniden kullanılır; boştaki işçiler `unref`
 *   edilir (süreç kapanışını engellemez), iş varken `ref` edilir. `closeParsePool()` işçileri sonlandırır.
 * - İşçi dosyası: derlenmiş halde `parseWorker.js`; TS kaynaktan (tsx/vitest) çalışırken `parseWorker.ts` + `--import tsx`.
 * - Önbellek: `cacheKey` (git blob SHA) verilirse model `cacheKey + path` anahtarıyla saklanır (varsayılan en çok 20 000 dosya
 *   ve toplam ~96 M karakter kaynak). Dönen modeller önbellekle PAYLAŞILIR: çağıranlar JavaFileModel'i değiştirmemelidir.
 */
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { parseJavaFile } from './extract.js';
import type { JavaFileModel } from './model.js';
import type { WorkerResult } from './parseWorker.js';

export interface ParseItem {
  path: string;
  source: string;
  /** İçeriğin kararlı kimliği (git blob SHA); verilirse sonuç önbelleklenir. */
  cacheKey?: string;
}

export interface ParseOptions {
  /** İşçi sayısı; varsayılan min(availableParallelism() - 1, 8), en az 1. 1 ise ana thread. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Bu sayının altında (önbellek dışı) dosyada havuz kullanılmaz. */
const SMALL_INPUT = 40;
/** İşçiye tek mesajda gönderilen dosya sayısı. */
const BATCH_SIZE = 16;
const MAX_WORKERS = 8;

// ---------------------------------------------------------------------------
// LRU önbellek
// ---------------------------------------------------------------------------

interface CacheEntry {
  model: JavaFileModel;
  chars: number;
}

const cache = new Map<string, CacheEntry>();
const cacheLimits = { maxEntries: 20_000, maxSourceChars: 96 * 1024 * 1024 };
let cacheChars = 0;
let cacheHits = 0;
let cacheMisses = 0;

function cacheKeyOf(item: ParseItem): string | undefined {
  return item.cacheKey ? `${item.cacheKey}\u0000${item.path}` : undefined;
}

function cacheGet(key: string): JavaFileModel | undefined {
  const e = cache.get(key);
  if (!e) {
    cacheMisses++;
    return undefined;
  }
  cache.delete(key);
  cache.set(key, e);
  cacheHits++;
  return e.model;
}

function evict(): void {
  while (cache.size > 0 && (cache.size > cacheLimits.maxEntries || cacheChars > cacheLimits.maxSourceChars)) {
    const oldest = cache.keys().next().value as string;
    const e = cache.get(oldest);
    cache.delete(oldest);
    if (e) cacheChars -= e.chars;
  }
}

function cacheSet(key: string, model: JavaFileModel, chars: number): void {
  const prev = cache.get(key);
  if (prev) {
    cache.delete(key);
    cacheChars -= prev.chars;
  }
  cache.set(key, { model, chars });
  cacheChars += chars;
  evict();
}

/** Önbellek sınırlarını ayarlar (girdi sayısı, toplam kaynak karakteri). */
export function configureParseCache(opts: { maxEntries?: number; maxSourceChars?: number }): void {
  if (opts.maxEntries !== undefined) cacheLimits.maxEntries = Math.max(0, opts.maxEntries);
  if (opts.maxSourceChars !== undefined) cacheLimits.maxSourceChars = Math.max(0, opts.maxSourceChars);
  evict();
}

export function clearParseCache(): void {
  cache.clear();
  cacheChars = 0;
  cacheHits = 0;
  cacheMisses = 0;
}

export function parseCacheStats(): { entries: number; sourceChars: number; hits: number; misses: number } {
  return { entries: cache.size, sourceChars: cacheChars, hits: cacheHits, misses: cacheMisses };
}

// ---------------------------------------------------------------------------
// İşçi havuzu
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (r: WorkerResult[]) => void;
  reject: (e: Error) => void;
}

/** Tek işçi; işler sırayla (eşzamanlı parseJavaFiles çağrıları kuyruğa girer). */
class PoolWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  dead = false;
  /** En az bir iş başarıyla döndü mü (başlangıçta ölen işçi = kullanılamaz giriş noktası). */
  everWorked = false;

  constructor(spec: WorkerSpec) {
    this.worker =
      spec.kind === 'file'
        ? new Worker(spec.url)
        : new Worker(spec.code, { eval: true, workerData: spec.workerData });
    this.worker.unref();
    this.worker.on('message', (msg: { id: number; models: WorkerResult[] }) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      this.everWorked = true;
      if (this.pending.size === 0) this.worker.unref();
      p.resolve(msg.models);
    });
    const fail = (error: Error): void => {
      if (!this.dead && !this.everWorked) workerSpecCache = null; // giriş noktası çalışmıyor: bir daha deneme
      this.dead = true;
      const all = [...this.pending.values()];
      this.pending.clear();
      for (const p of all) p.reject(error);
    };
    this.worker.on('error', fail);
    this.worker.on('exit', (code) => fail(new Error(`ayrıştırma işçisi sonlandı (kod ${code})`)));
  }

  /** İşçi mesajları sırayla işler; birden çok bekleyen iş olabilir. */
  exec(items: { path: string; source: string }[]): Promise<WorkerResult[]> {
    if (this.dead) return Promise.reject(new Error('ayrıştırma işçisi kullanılamıyor'));
    const id = this.nextId++;
    return new Promise<WorkerResult[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.ref();
      this.worker.postMessage({ id, items });
    });
  }

  async terminate(): Promise<void> {
    this.dead = true;
    await this.worker.terminate();
  }
}

const pool: PoolWorker[] = [];
const poolCounters = { workerBatches: 0, mainFallbackBatches: 0 };

/** Havuz sayaçları (tanı/test): açık işçi sayısı, işçide ve ana thread'e düşerek işlenen paketler. */
export function parsePoolStats(): { workers: number; workerBatches: number; mainFallbackBatches: number } {
  return { workers: pool.filter((w) => !w.dead).length, ...poolCounters };
}
type WorkerSpec =
  | { kind: 'file'; url: URL }
  | { kind: 'eval'; code: string; workerData: { api: string; entry: string } };

let workerSpecCache: WorkerSpec | null | undefined;

/**
 * TS kaynaktan çalışırken (tsx/vitest) işçi önyükleyicisi: tsx ESM kancalarını işçide kaydeder, sonra parseWorker.ts'i
 * yükler. (`execArgv: ['--import', 'tsx']` Node 22'de işçide kanca etkinleştirmiyor; .js -> .ts çözümü başarısız oluyor.)
 */
const TS_BOOTSTRAP = `
const { workerData } = require('node:worker_threads');
(async () => {
  const api = await import(workerData.api);
  const register = api.register ?? (api.default && api.default.register);
  register();
  await import(workerData.entry);
})().catch((e) => { setImmediate(() => { throw e; }); });
`;

/** İşçi giriş noktası: derlenmiş JS'de parseWorker.js; TS kaynakta önyükleyici + tsx + parseWorker.ts. */
function workerSpec(): WorkerSpec | undefined {
  if (workerSpecCache !== undefined) return workerSpecCache ?? undefined;
  const here = import.meta.url;
  if (/\.ts$/.test(new URL(here).pathname)) {
    try {
      const api = createRequire(here).resolve('tsx/esm/api').replace(/\.cjs$/, '.mjs');
      workerSpecCache = {
        kind: 'eval',
        code: TS_BOOTSTRAP,
        workerData: { api: pathToFileURL(api).href, entry: new URL('./parseWorker.ts', here).href },
      };
    } catch {
      workerSpecCache = null;
    }
  } else {
    workerSpecCache = { kind: 'file', url: new URL('./parseWorker.js', here) };
  }
  return workerSpecCache ?? undefined;
}

function ensurePool(size: number): PoolWorker[] {
  for (let i = pool.length - 1; i >= 0; i--) if ((pool[i] as PoolWorker).dead) pool.splice(i, 1);
  const spec = workerSpec();
  if (!spec) return [];
  while (pool.length < size) {
    try {
      pool.push(new PoolWorker(spec));
    } catch {
      break;
    }
  }
  return pool.slice(0, size);
}

/** Havuzdaki tüm işçileri sonlandırır (sonraki çağrı yeniden açar). */
export async function closeParsePool(): Promise<void> {
  const ws = pool.splice(0, pool.length);
  await Promise.all(ws.map((w) => w.terminate().catch(() => undefined)));
}

export function defaultParseConcurrency(): number {
  return Math.max(1, Math.min(availableParallelism() - 1, MAX_WORKERS));
}

async function parseOnMain(item: ParseItem): Promise<JavaFileModel> {
  return parseJavaFile(item.path, item.source);
}

/**
 * Dosyaları ayrıştırır (önbellek + işçi havuzu). Sonuç dizisi girdi sırasıyla. Tek bir dosyanın ayrıştırma hatası
 * tüm çağrıyı düşürür (parseJavaFile ile aynı davranış); işçi çökmesinde ana thread'e düşülür.
 */
export async function parseJavaFiles(items: ParseItem[], opts: ParseOptions = {}): Promise<JavaFileModel[]> {
  const total = items.length;
  const results = new Array<JavaFileModel | undefined>(total);
  let done = 0;
  const tick = (n: number): void => {
    done += n;
    opts.onProgress?.(done, total);
  };
  const todo: number[] = [];
  for (let i = 0; i < total; i++) {
    const key = cacheKeyOf(items[i] as ParseItem);
    const hit = key ? cacheGet(key) : undefined;
    if (hit) results[i] = hit;
    else todo.push(i);
  }
  if (total - todo.length > 0) tick(total - todo.length);

  const store = (i: number, model: JavaFileModel): void => {
    results[i] = model;
    const it = items[i] as ParseItem;
    const key = cacheKeyOf(it);
    if (key) cacheSet(key, model, it.source.length);
  };

  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? defaultParseConcurrency()));
  const workers = todo.length >= SMALL_INPUT && concurrency > 1 ? ensurePool(Math.min(concurrency, Math.ceil(todo.length / BATCH_SIZE))) : [];

  if (workers.length === 0) {
    for (const i of todo) {
      store(i, await parseOnMain(items[i] as ParseItem));
      tick(1);
    }
    return results as JavaFileModel[];
  }

  let next = 0;
  const takeBatch = (): number[] => {
    const b = todo.slice(next, next + BATCH_SIZE);
    next += b.length;
    return b;
  };
  const runMain = async (batch: number[]): Promise<void> => {
    for (const i of batch) {
      store(i, await parseOnMain(items[i] as ParseItem));
      tick(1);
    }
  };
  const loop = async (w: PoolWorker): Promise<void> => {
    for (;;) {
      const batch = takeBatch();
      if (batch.length === 0) return;
      if (w.dead) {
        poolCounters.mainFallbackBatches++;
        await runMain(batch);
        continue;
      }
      let res: WorkerResult[];
      try {
        res = await w.exec(batch.map((i) => ({ path: (items[i] as ParseItem).path, source: (items[i] as ParseItem).source })));
        poolCounters.workerBatches++;
      } catch {
        poolCounters.mainFallbackBatches++;
        await runMain(batch);
        continue;
      }
      for (let k = 0; k < batch.length; k++) {
        const i = batch[k] as number;
        const r = res[k];
        if (r && !('error' in r)) store(i, r);
        else store(i, await parseOnMain(items[i] as ParseItem)); // işçide hata: ana thread'de yeniden dene (hata buradan fırlar)
      }
      tick(batch.length);
    }
  };
  await Promise.all(workers.map((w) => loop(w)));
  return results as JavaFileModel[];
}

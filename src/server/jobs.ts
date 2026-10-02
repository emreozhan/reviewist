/**
 * Arka plan analiz işleri (POST /api/jobs, GET /api/jobs/:id) ve eşzamanlı analiz sınırı (kuyruk).
 * İş durumu bellekte tutulur; biten işler `ttlMs` (varsayılan 10 dk) sonra silinir.
 */
import { randomUUID } from 'node:crypto';
import type { ApiError, ReviewJob } from '../shared/types.js';
import { isSourceError, shortMessage } from '../sources/errors.js';

// ---------------------------------------------------------------------------
// Hata → ApiError
// ---------------------------------------------------------------------------

/** Hata nesnesini HTTP durum kodu + ApiError'a çevirir (stack ya da gizli bilgi yok). */
export function toApiError(err: unknown): { status: number; body: ApiError } {
  if (isSourceError(err)) {
    const body: ApiError = { error: err.message };
    if (err.detail) body.detail = err.detail;
    if (err.field) body.field = err.field;
    return { status: err.status, body };
  }
  return { status: 500, body: { error: 'Beklenmeyen sunucu hatası.', detail: shortMessage(err, 300) } };
}

// ---------------------------------------------------------------------------
// AnalysisQueue: en fazla N analiz aynı anda
// ---------------------------------------------------------------------------

export class AnalysisQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  /** Bekleyen (başlamamış) iş sayısı. */
  get queued(): number {
    return this.waiting.length;
  }

  get running(): number {
    return this.active;
  }

  /**
   * `fn`'i bir yuva boşalınca çalıştırır. Yuva doluysa `onQueued(sıradakiKonum)` çağrılır (1 tabanlı).
   */
  async run<T>(fn: () => Promise<T>, onQueued?: (position: number) => void): Promise<T> {
    if (this.active >= this.concurrency) {
      const wait = new Promise<void>((r) => this.waiting.push(r));
      onQueued?.(this.waiting.length);
      await wait; // yuva doğrudan devredilir (active değişmez)
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

// ---------------------------------------------------------------------------
// JobManager
// ---------------------------------------------------------------------------

/** İşi yürüten fonksiyon: ilerlemeyi bildirir, review id'si döner. Kuyruk sınırı çağıran tarafından uygulanır. */
export type JobRunner = (onProgress: (msg: string) => void) => Promise<string>;

export interface JobManagerOptions {
  /** Biten işlerin tutulma süresi (ms). Varsayılan 10 dk. */
  ttlMs?: number;
  /** İş başına en fazla ilerleme kaydı (eskiler atılır, ilk kayıt korunur). Varsayılan 1000. */
  maxProgress?: number;
  /** Test için saat. */
  now?: () => number;
  /** Her ilerleme mesajı için (ör. CLI konsolu). */
  onProgress?: (msg: string, jobId: string) => void;
}

interface JobEntry {
  job: ReviewJob;
  finishedAt?: number;
  done: Promise<void>;
}

function newJobId(): string {
  return `j-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export class JobManager {
  private readonly jobs = new Map<string, JobEntry>();
  private readonly ttlMs: number;
  private readonly maxProgress: number;
  private readonly now: () => number;

  constructor(private readonly opts: JobManagerOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
    this.maxProgress = Math.max(2, opts.maxProgress ?? 1000);
    this.now = opts.now ?? Date.now;
  }

  /** İşi başlatır (arka planda) ve ilk anlık görüntüyü döner. Hata fırlatmaz; hata işin durumuna yazılır. */
  start(runner: JobRunner): ReviewJob {
    this.prune();
    const id = newJobId();
    const job: ReviewJob = { id, status: 'running', startedAt: new Date(this.now()).toISOString(), progress: [] };
    const push = (message: string): void => {
      const last = job.progress[job.progress.length - 1];
      if (last?.message === message) return;
      job.progress.push({ at: new Date(this.now()).toISOString(), message });
      if (job.progress.length > this.maxProgress) job.progress.splice(1, 1);
      this.opts.onProgress?.(message, id);
    };
    const entry: JobEntry = { job, done: Promise.resolve() };
    entry.done = (async () => {
      try {
        // Kuyruk sınırı runner içinde (AnalysisQueue) uygulanır; beklerken iş 'running' kalır.
        job.reviewId = await runner(push);
        job.status = 'done';
        push(`Review hazır: ${job.reviewId}`);
      } catch (err) {
        const { status, body } = toApiError(err);
        if (status >= 500 && !isSourceError(err)) {
          console.error(`[reviewist] İş ${id} başarısız: ${shortMessage(err, 300)}`);
        }
        job.error = body;
        job.status = 'error';
      } finally {
        entry.finishedAt = this.now();
      }
    })();
    this.jobs.set(id, entry);
    return snapshot(job);
  }

  /** İşin anlık görüntüsü; bilinmiyor ya da süresi dolmuşsa undefined. */
  get(id: string): ReviewJob | undefined {
    this.prune();
    const e = this.jobs.get(id);
    return e ? snapshot(e.job) : undefined;
  }

  /** İş bitene kadar bekler (CLI ve testler için). */
  async wait(id: string): Promise<ReviewJob | undefined> {
    const e = this.jobs.get(id);
    if (!e) return undefined;
    await e.done;
    return snapshot(e.job);
  }

  get size(): number {
    return this.jobs.size;
  }

  private prune(): void {
    const t = this.now();
    for (const [id, e] of this.jobs) {
      if (e.finishedAt !== undefined && t - e.finishedAt >= this.ttlMs) this.jobs.delete(id);
    }
  }
}

function snapshot(job: ReviewJob): ReviewJob {
  const out: ReviewJob = { ...job, progress: job.progress.map((p) => ({ ...p })) };
  if (job.error) out.error = { ...job.error };
  return out;
}

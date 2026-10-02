/**
 * Ayrıştırma işçisi (worker_threads): kendi tree-sitter örneğini yükler, gelen dosya paketlerini `parseJavaFile` ile işler.
 * Mesaj: { id, items: { path, source }[] } -> yanıt: { id, models: (JavaFileModel | { error: string })[] }
 */
import { parentPort } from 'node:worker_threads';
import { parseJavaFile } from './extract.js';
import type { JavaFileModel } from './model.js';

interface Job {
  id: number;
  items: { path: string; source: string }[];
}

export type WorkerResult = JavaFileModel | { error: string };

if (parentPort) {
  const port = parentPort;
  port.on('message', (job: Job) => {
    void (async () => {
      const models: WorkerResult[] = [];
      for (const it of job.items) {
        try {
          models.push(await parseJavaFile(it.path, it.source));
        } catch (error) {
          models.push({ error: error instanceof Error ? error.message : String(error) });
        }
      }
      port.postMessage({ id: job.id, models });
    })();
  });
}

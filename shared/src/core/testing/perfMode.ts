/**
 * Mutlak süre doğrulamaları yalnız performans modunda çalışır: `REVIEWIST_PERF=1` ya da `npm run test:perf`.
 * Tam test seti paralel koşarken CPU paylaşıldığı için süre sınırları kararsızdır; doğruluk kontrolleri her zaman çalışır.
 */
export function perfMode(): boolean {
  return process.env.REVIEWIST_PERF === '1' || process.env.npm_lifecycle_event === 'test:perf';
}

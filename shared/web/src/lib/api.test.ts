import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadProgress } from './apiTypes';
import { realApi } from './api';

function streamOf(text: string, chunk: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let pos = 0;
  return new ReadableStream({
    pull(controller) {
      if (pos >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(pos, pos + chunk));
      pos += chunk;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('büyük review yükleme ilerlemesi', () => {
  const model = { id: 'r1', title: 'çok baytlı karakterler: ğüşıöç', items: Array.from({ length: 2000 }, (_, i) => ({ i, s: 'xxxxxxxxxx' })) };
  const text = JSON.stringify(model);

  it('gövdeyi parça parça okur: indirme → ayrıştırma aşamaları, çok baytlı karakterler bozulmaz', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf(text, 997), { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(text).length) } })));
    const seen: LoadProgress[] = [];
    const out = await realApi.getReview('r1', { onProgress: (p) => seen.push(p) });
    expect(out).toEqual(model);
    expect(seen[0]?.phase).toBe('download');
    expect(seen.at(-1)?.phase).toBe('parse');
    expect(seen.at(-1)?.loaded).toBe(new TextEncoder().encode(text).length);
    expect(seen.at(-1)?.total).toBe(seen.at(-1)?.loaded);
  });

  it('sıkıştırılmış yanıtta toplam bilinmez sayılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf(text, 4096), { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '1234' } })));
    const seen: LoadProgress[] = [];
    await realApi.getReview('r1', { onProgress: (p) => seen.push(p) });
    expect(seen.every((p) => p.total === undefined)).toBe(true);
  });

  it('bozuk JSON Türkçe ayrıştırma hatası verir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf('{"id":', 3), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(realApi.getReview('r1', { onProgress: () => undefined })).rejects.toMatchObject({ kind: 'parse', message: 'Sunucu yanıtı çözümlenemedi.' });
  });

  it('ilerleme istenmezse eski yol (res.json) kullanılır', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(realApi.getReview('r1')).resolves.toEqual(model);
  });
});

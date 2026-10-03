import { useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { FileOutline, ReviewModel, SymbolLocation } from '../../../src/shared/types';
import type { FileSide, ReviewApi } from '../lib/api';
import { getApi, isApiError, isUnsupportedEndpoint } from '../lib/api';
import { splitLines } from '../lib/lcs';
import { buildIndex } from '../lib/reviewIndex';
import type { ReviewIndex } from '../lib/reviewIndex';
import { yieldToPaint } from '../lib/yieldToPaint';
import { useApiMode } from '../state/apiMode';
import { useLoad } from '../state/loadStore';
import { capKey, useNavCaps } from '../state/navCaps';

export function useApi(): { api: ReviewApi; mock: boolean } {
  const mock = useApiMode((s) => s.mock);
  return { api: getApi(mock), mock };
}

export const queryKeys = {
  config: (mock: boolean) => ['config', mock] as const,
  refs: (mock: boolean, repoPath: string) => ['refs', mock, repoPath] as const,
  reviews: (mock: boolean) => ['reviews', mock] as const,
  review: (mock: boolean, id: string) => ['review', mock, id] as const,
  file: (mock: boolean, id: string, path: string, side: FileSide) => ['file', mock, id, path, side] as const,
  outline: (mock: boolean, id: string, path: string, side: FileSide) => ['outline', mock, id, path, side] as const,
  locate: (mock: boolean, id: string, symbolId: string) => ['locate', mock, id, symbolId] as const,
};

export function useConfig() {
  const { api, mock } = useApi();
  return useQuery({ queryKey: queryKeys.config(mock), queryFn: () => api.getConfig(), staleTime: Infinity });
}

export function useRefs(repoPath: string) {
  const { api, mock } = useApi();
  return useQuery({
    queryKey: queryKeys.refs(mock, repoPath),
    queryFn: () => api.getRefs(repoPath),
    enabled: repoPath.trim() !== '',
    staleTime: 30_000,
  });
}

export function useReviewList() {
  const { api, mock } = useApi();
  return useQuery({ queryKey: queryKeys.reviews(mock), queryFn: () => api.listReviews() });
}

/** Ağır işler (ayrıştırma sonrası indeks) ekrana ilerleme çizilebilsin diye kare sonrasına bırakılır. */
export async function prepareIndex(review: ReviewModel, onIndex?: () => void): Promise<ReviewIndex> {
  onIndex?.();
  await yieldToPaint();
  return getIndex(review);
}

export function useReview(id: string) {
  const { api, mock } = useApi();
  return useQuery({
    queryKey: queryKeys.review(mock, id),
    queryFn: async ({ signal }) => {
      const load = useLoad.getState();
      try {
        const review = await api.getReview(id, { signal, onProgress: (p) => load.report(id, p) });
        await prepareIndex(review, () => load.report(id, { phase: 'index', loaded: 0 }));
        return review;
      } finally {
        useLoad.getState().clear(id);
      }
    },
    staleTime: Infinity,
    // Onlarca MB'lık modelde derin karşılaştırma pahalı ve gereksiz (model değişmez).
    structuralSharing: false,
  });
}

/** Dosyanın tam içeriği (satırlara bölünmüş). İçerik yoksa `lines` null. */
export function useFileContent(reviewId: string, path: string | undefined, side: FileSide, enabled = true) {
  const { api, mock } = useApi();
  const query = useQuery({
    queryKey: queryKeys.file(mock, reviewId, path ?? '', side),
    queryFn: () => api.getFile(reviewId, path ?? '', side),
    enabled: enabled && !!path,
    staleTime: Infinity,
    retry: 1,
  });
  const content = query.data?.content;
  const lines = useMemo(() => (typeof content === 'string' ? splitLines(content) : null), [content]);
  return { ...query, content: typeof content === 'string' ? content : null, lines };
}

const indexCache = new WeakMap<ReviewModel, ReviewIndex>();

/** Aynı ReviewModel nesnesi için indeksi bir kez kurar. */
export function getIndex(review: ReviewModel): ReviewIndex {
  let idx = indexCache.get(review);
  if (!idx) {
    idx = buildIndex(review);
    indexCache.set(review, idx);
  }
  return idx;
}

/** Koddan gezinme bu sunucuda kullanılabilir mi (outline ucu var mı; bilinmiyorsa true). */
export function useOutlineSupported(): boolean {
  const mock = useApiMode((s) => s.mock);
  return useNavCaps((s) => !s.missing[capKey(mock, 'outline')]);
}

/**
 * Dosyanın sembol ana hattı ve referansları (review + yol + taraf başına önbellekli).
 * Uç yoksa (eski sunucu) bir kez işaretlenir ve bir daha istenmez; dosya yoksa (404) veri undefined kalır.
 */
export function useOutline(reviewId: string, path: string | undefined, side: FileSide, enabled = true) {
  const { api, mock } = useApi();
  const supported = useOutlineSupported();
  return useQuery<FileOutline>({
    queryKey: queryKeys.outline(mock, reviewId, path ?? '', side),
    queryFn: async ({ signal }) => {
      try {
        return await api.getOutline(reviewId, path ?? '', side, signal);
      } catch (error) {
        if (isUnsupportedEndpoint(error)) useNavCaps.getState().markMissing(mock, 'outline');
        throw error;
      }
    },
    enabled: enabled && !!path && supported,
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Sembol konumu (`/locate`), önbellekli. Uç yoksa ya da sembol bulunamazsa null (çağıran ReviewModel tahminine düşer).
 * Ağ hatası (sunucu kapalı) de null döner; konum bulma tıklamayı engellemez.
 */
export async function fetchLocation(client: QueryClient, api: ReviewApi, mock: boolean, reviewId: string, symbolId: string): Promise<SymbolLocation | null> {
  if (useNavCaps.getState().missing[capKey(mock, 'locate')]) return null;
  try {
    return await client.fetchQuery({
      queryKey: queryKeys.locate(mock, reviewId, symbolId),
      queryFn: ({ signal }) => api.locate(reviewId, symbolId, signal),
      staleTime: Infinity,
      retry: false,
    });
  } catch (error) {
    if (isUnsupportedEndpoint(error)) useNavCaps.getState().markMissing(mock, 'locate');
    else if (!(isApiError(error) && error.status === 404)) console.warn('Sembol konumu alınamadı', error);
    return null;
  }
}

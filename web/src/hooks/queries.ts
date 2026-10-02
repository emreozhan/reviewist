import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ReviewModel } from '../../../src/shared/types';
import type { FileSide, ReviewApi } from '../lib/api';
import { getApi } from '../lib/api';
import { splitLines } from '../lib/lcs';
import { buildIndex } from '../lib/reviewIndex';
import type { ReviewIndex } from '../lib/reviewIndex';
import { useApiMode } from '../state/apiMode';

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

export function useReview(id: string) {
  const { api, mock } = useApi();
  return useQuery({ queryKey: queryKeys.review(mock, id), queryFn: () => api.getReview(id), staleTime: Infinity });
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

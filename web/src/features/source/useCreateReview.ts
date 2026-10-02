import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { ReviewModel, ReviewRequest } from '../../../../src/shared/types';
import { navigate } from '../../lib/route';
import { queryKeys, useApi } from '../../hooks/queries';

/** Analizi başlatır; iptal edilebilir. Başarıda review ekranına geçer. */
export function useCreateReview() {
  const { api, mock } = useApi();
  const queryClient = useQueryClient();
  const controller = useRef<AbortController | null>(null);

  const mutation = useMutation<ReviewModel, Error, ReviewRequest>({
    mutationFn: async (req) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      return api.createReview(req, ac.signal);
    },
    onSuccess: async (model) => {
      queryClient.setQueryData(queryKeys.review(mock, model.id), model);
      await queryClient.invalidateQueries({ queryKey: queryKeys.reviews(mock) });
      navigate({ name: 'review', id: model.id, tab: 'workspace', params: {} });
    },
  });

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    mutation.reset();
  };

  return { ...mutation, cancel };
}

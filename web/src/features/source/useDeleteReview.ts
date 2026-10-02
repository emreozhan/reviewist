import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReviewListItem } from '../../../../src/shared/types';
import { queryKeys, useApi } from '../../hooks/queries';

/** Review'ı sunucudan siler; listeden hemen düşürür, hata olursa listeyi yeniler. */
export function useDeleteReview() {
  const { api, mock } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.deleteReview(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<ReviewListItem[]>(queryKeys.reviews(mock), (list) => list?.filter((r) => r.id !== id));
      queryClient.removeQueries({ queryKey: queryKeys.review(mock, id) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviews(mock) }),
  });
}

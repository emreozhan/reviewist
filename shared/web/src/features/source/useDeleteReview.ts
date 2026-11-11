import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReviewListItem, ReviewModel } from '../../../../src/shared/types';
import { queryKeys, useApi } from '../../hooks/queries';
import { storageKey } from '../../lib/persistence';
import { forgetReviewState } from '../../lib/reviewKeys';
import { tabsStorageKey } from '../../state/tabsStore';

/**
 * İncelemeyi sunucudan siler; listeden hemen düşürür, hata olursa listeyi yeniler. Başarıda o incelemenin bu
 * tarayıcıdaki görüldü/not ve sekme kayıtları da silinir (yeniden analizde geri gelmesin). Düzen ve son depolar kalır.
 */
export function useDeleteReview() {
  const { api, mock } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.deleteReview(id),
    onSuccess: (_data, id) => {
      // Anahtar önce sunucu listesindeki stableKey'den, yoksa önbellekteki modelden türetilir.
      const listed = queryClient.getQueryData<ReviewListItem[]>(queryKeys.reviews(mock))?.find((r) => r.id === id);
      const model = queryClient.getQueryData<ReviewModel>(queryKeys.review(mock, id));
      const stableKey = listed?.stableKey || model?.source.stableKey;
      const known = stableKey
        ? { progress: `reviewist:${stableKey}`, tabs: tabsStorageKey(stableKey) }
        : model
          ? { progress: storageKey(model), tabs: tabsStorageKey(model.id) }
          : undefined;
      forgetReviewState(id, known);
      queryClient.setQueryData<ReviewListItem[]>(queryKeys.reviews(mock), (list) => list?.filter((r) => r.id !== id));
      queryClient.removeQueries({ queryKey: queryKeys.review(mock, id) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviews(mock) }),
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReviewModel, ReviewRequest } from '../../../../src/shared/types';
import type { AnalysisProgressState } from '../../lib/analysisRunner';
import { runAnalysis } from '../../lib/analysisRunner';
import { navigate } from '../../lib/route';
import { queryKeys, useApi } from '../../hooks/queries';

const IDLE: AnalysisProgressState = { mode: 'job', messages: [] };

/**
 * Analizi iş olarak başlatır, ilerlemeyi izler; iptal edilebilir (sorgulama bırakılır).
 * Başarıda review ekranına geçer.
 */
export function useCreateReview() {
  const { api, mock } = useApi();
  const queryClient = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<AnalysisProgressState>(IDLE);

  const mutation = useMutation<ReviewModel, Error, ReviewRequest>({
    mutationFn: async (req) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setProgress(IDLE);
      return runAnalysis(api, req, { signal: ac.signal, onProgress: (p) => !ac.signal.aborted && setProgress(p) });
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

  return { ...mutation, progress, cancel };
}

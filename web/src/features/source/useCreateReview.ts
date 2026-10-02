import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReviewModel, ReviewRequest } from '../../../../src/shared/types';
import type { AnalysisProgressState } from '../../lib/analysisRunner';
import { runAnalysis } from '../../lib/analysisRunner';
import { navigate } from '../../lib/route';
import { prepareIndex, queryKeys, useApi } from '../../hooks/queries';

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
      const report = (p: AnalysisProgressState) => {
        if (!ac.signal.aborted) setProgress(p);
      };
      let last: AnalysisProgressState = IDLE;
      const model = await runAnalysis(api, req, { signal: ac.signal, onProgress: (p) => { last = p; report(p); } });
      // İndeks burada (ilerleme göstergesi açıkken) kurulur; review ekranı açılınca hazırdır.
      await prepareIndex(model, () => report({ ...last, download: { phase: 'index', loaded: last.download?.loaded ?? 0 } }));
      return model;
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

import { useEffect } from 'react';
import { ErrorPanel } from '../../components/ErrorPanel';
import { MockBadge } from '../../components/MockBadge';
import { getIndex, useReview } from '../../hooks/queries';
import { isApiError } from '../../lib/api';
import type { RouteParams, Tab } from '../../lib/route';
import { formatHash, navigate } from '../../lib/route';
import { useNotice } from '../../state/noticeStore';
import { LoadingState } from './LoadingState';
import { ReviewLayout } from './ReviewLayout';
import { ReviewProvider } from './ReviewContext';

interface ReviewScreenProps {
  id: string;
  tab: Tab;
  params: RouteParams;
}

/** Açılışta config.initialReviewId ile otomatik açılan review sunucuda yoksa (404) sessizce başlangıca dönülür. */
function useInitialReviewFallback(id: string, error: unknown): boolean {
  const attempt = useNotice((s) => s.initialAttemptId);
  const missing = attempt === id && isApiError(error) && error.status === 404;
  useEffect(() => {
    if (!missing) return;
    const n = useNotice.getState();
    n.markInitialAttempt(null);
    n.setNotice(`Son açılan review (${id}) sunucuda artık yok; yeni bir analiz başlatabilir ya da son review'lardan birini açabilirsiniz.`);
    navigate({ name: 'home' }, true);
  }, [missing, id]);
  return missing;
}

export function ReviewScreen({ id, tab, params }: ReviewScreenProps) {
  const query = useReview(id);
  const redirecting = useInitialReviewFallback(id, query.error);

  useEffect(() => {
    // Otomatik açılış başarılıysa işaret temizlenir (sonraki 404'ler normal hata ekranını gösterir).
    if (query.isSuccess) useNotice.getState().markInitialAttempt(null);
  }, [query.isSuccess]);

  if (query.isPending || redirecting) return <LoadingState id={id} />;
  if (query.isError) {
    return (
      <div className="screen-state">
        <MockBadge />
        <ErrorPanel
          error={query.error}
          title="Review açılamadı"
          action={
            <a className="btn" href={formatHash({ name: 'home' })}>
              Başlangıca dön
            </a>
          }
        />
      </div>
    );
  }
  const review = query.data;
  return (
    <ReviewProvider review={review} index={getIndex(review)}>
      <ReviewLayout tab={tab} params={params} />
    </ReviewProvider>
  );
}

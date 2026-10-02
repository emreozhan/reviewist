import { ErrorPanel } from '../../components/ErrorPanel';
import { MockBadge } from '../../components/MockBadge';
import { getIndex, useReview } from '../../hooks/queries';
import type { RouteParams, Tab } from '../../lib/route';
import { formatHash } from '../../lib/route';
import { ReviewLayout } from './ReviewLayout';
import { ReviewProvider } from './ReviewContext';

interface ReviewScreenProps {
  id: string;
  tab: Tab;
  params: RouteParams;
}

export function ReviewScreen({ id, tab, params }: ReviewScreenProps) {
  const query = useReview(id);

  if (query.isPending) {
    return (
      <div className="screen-state" aria-busy="true">
        <span className="screen-state__pulse" aria-hidden="true" />
        <p>Review yükleniyor…</p>
      </div>
    );
  }
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

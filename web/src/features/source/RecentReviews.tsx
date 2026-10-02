import { useReviewList } from '../../hooks/queries';
import { formatHash } from '../../lib/route';
import { DeleteReviewButton } from './DeleteReviewButton';
import { useDeleteReview } from './useDeleteReview';

const KIND_LABEL = { git: 'git', github: 'PR', patch: 'patch' } as const;

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch (error) {
    console.warn('Tarih biçimlenemedi', error);
    return iso;
  }
}

export function RecentReviews() {
  const list = useReviewList();
  const del = useDeleteReview();
  return (
    <section className="recent" aria-labelledby="recent-title">
      <h2 id="recent-title" className="section-title">
        Son incelemeler
      </h2>
      {list.isPending && <p className="muted">Yükleniyor…</p>}
      {list.isError && <p className="muted">Liste alınamadı: {list.error.message}</p>}
      {list.data && list.data.length === 0 && <p className="muted">Henüz analiz yok. Soldan bir kaynak seçip başlayın.</p>}
      {del.isError && (
        <p className="recent__error" role="alert">
          Silinemedi: {del.error.message}
        </p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="recent__list">
          {list.data.map((r) => (
            <li key={r.id} className="recent__row">
              <a className="recent__item" href={formatHash({ name: 'review', id: r.id, tab: 'workspace', params: {} })}>
                <span className={`recent__kind recent__kind--${r.kind}`}>{KIND_LABEL[r.kind]}</span>
                <span className="recent__title">{r.title}</span>
                <span className="recent__meta">
                  <span className="gauge">{r.files} dosya</span> · {formatDate(r.createdAt)}
                </span>
              </a>
              <DeleteReviewButton title={r.title} pending={del.isPending && del.variables === r.id} onConfirm={() => del.mutate(r.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

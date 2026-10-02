import { useReviewList } from '../../hooks/queries';
import { formatHash } from '../../lib/route';

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
  return (
    <section className="recent" aria-labelledby="recent-title">
      <h2 id="recent-title" className="section-title">
        Son incelemeler
      </h2>
      {list.isPending && <p className="muted">Yükleniyor…</p>}
      {list.isError && <p className="muted">Liste alınamadı: {list.error.message}</p>}
      {list.data && list.data.length === 0 && <p className="muted">Henüz analiz yok. Soldan bir kaynak seçip başlayın.</p>}
      {list.data && list.data.length > 0 && (
        <ul className="recent__list">
          {list.data.map((r) => (
            <li key={r.id}>
              <a className="recent__item" href={formatHash({ name: 'review', id: r.id, tab: 'workspace', params: {} })}>
                <span className={`recent__kind recent__kind--${r.kind}`}>{KIND_LABEL[r.kind]}</span>
                <span className="recent__title">{r.title}</span>
                <span className="recent__meta">
                  <span className="gauge">{r.files} dosya</span> · {formatDate(r.createdAt)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

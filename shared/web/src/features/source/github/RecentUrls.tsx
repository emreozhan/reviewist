interface RecentUrlsProps {
  urls: readonly string[];
  onPick: (url: string) => void;
}

/** GitHub sürümü: son başarılı analizlerin adresleri; tıklayınca adres alanına yazılır. */
export function RecentUrls({ urls, onPick }: RecentUrlsProps) {
  if (urls.length === 0) return null;
  return (
    <div className="recent-urls" role="group" aria-label="Son adresler">
      <span className="recent-urls__title">Son adresler</span>
      <ul className="recent-urls__list">
        {urls.map((u) => (
          <li key={u}>
            <button type="button" className="recent-urls__item" onClick={() => onPick(u)} title={`Adres alanına yaz: ${u}`}>
              {u}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

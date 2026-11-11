import type { SourceFormProps } from '../sourceFormProps';
import { GithubForm } from './GithubForm';

/** Yalnız GitHub sürümü: sekmesiz tek kaynak kartı + uzak deponun nasıl okunduğunu anlatan bilgi kutusu. */
export function GithubSource(props: SourceFormProps) {
  const { config } = props;
  return (
    <div className="source-card">
      <div className="source-panel">
        <GithubForm {...props} />
      </div>
      <div className="source-note">
        <p className="source-note__text">
          Depo, git ile bu bilgisayardaki önbelleğe indirilir ({config?.cacheDir ? <code className="source-note__path">{config.cacheDir}</code> : 'sunucunun önbellek klasörü'}) ve yerelde
          analiz edilir. Özel depolar için git'in erişimi olmalı (credential helper ya da SSH anahtarı).
        </p>
        {config && (
          <p className={`source-note__token${config.githubTokenConfigured ? ' is-on' : ''}`}>
            <span className="source-note__dot" aria-hidden="true" />
            {config.githubTokenConfigured
              ? 'PR bilgisi için GITHUB_TOKEN kullanılacak.'
              : 'GITHUB_TOKEN tanımlı değil: PR başlığı/hedef dalı yalnız herkese açık depolarda otomatik alınır; gerekirse taban dalı elle girin.'}
          </p>
        )}
      </div>
    </div>
  );
}

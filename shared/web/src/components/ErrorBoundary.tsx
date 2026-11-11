import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ErrorPanel } from './ErrorPanel';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Ayrı yüklenen parça (lazy chunk) indirilemedi mi (ağ kesildi, sunucu yeniden derlendi / önbellek eskidi)? */
export function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|Failed to fetch|Loading chunk|error loading dynamically/i.test(error.message);
}

/**
 * Üst düzey hata sınırı: render sırasında fırlatılan hatalar ve yüklenemeyen lazy parçalar boş/kırık ekran yerine
 * Türkçe bir iletiyle "Yeniden yükle" ve "Başlangıca dön" seçeneklerini gösterir.
 * Not: React hata sınırları yalnız sınıf bileşeniyle yazılabilir (fonksiyonel karşılığı yok).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Arayüz hatası', error, info.componentStack);
  }

  private goHome = () => {
    window.location.hash = '#/';
    this.setState({ error: null });
  };

  private reload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    return (
      <div className="screen-state">
        <ErrorPanel
          error={error}
          title={chunk ? 'Arayüzün bir parçası yüklenemedi' : 'Beklenmeyen bir arayüz hatası oluştu'}
          action={
            <>
              <p className="muted">
                {chunk
                  ? 'Ağ bağlantısı kesilmiş ya da Reviewist güncellenmiş olabilir; sayfayı yeniden yüklemek genellikle sorunu giderir.'
                  : 'Sayfayı yeniden yükleyebilir ya da başlangıç ekranına dönebilirsiniz. Notlarınız ve görüldü işaretleriniz tarayıcıda saklı kalır.'}
              </p>
              <button type="button" className="btn btn--primary" onClick={this.reload}>
                Yeniden yükle
              </button>{' '}
              <button type="button" className="btn" onClick={this.goHome}>
                Başlangıca dön
              </button>
            </>
          }
        />
      </div>
    );
  }
}

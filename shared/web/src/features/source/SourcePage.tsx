import { useEffect } from 'react';
import { ErrorPanel } from '../../components/ErrorPanel';
import { isApiError } from '../../lib/api';
import { MockBadge } from '../../components/MockBadge';
import { ThemeToggle } from '../../components/ThemeToggle';
import { useConfig } from '../../hooks/queries';
import { APP_NAME, editionMismatch } from '../../lib/edition';
import { navigate, parseHash } from '../../lib/route';
import { useApiMode } from '../../state/apiMode';
import { useNotice } from '../../state/noticeStore';
import { AnalysisProgress } from './AnalysisProgress';
import { GithubSource } from './github/GithubSource';
import { RecentReviews } from './RecentReviews';
import { SourceTabs } from './SourceTabs';
import type { ServerFieldError } from './serverFieldError';
import { formHasField } from './serverFieldError';
import type { SourceFormProps } from './sourceFormProps';
import { useCreateReview } from './useCreateReview';

/** Sürümün kaynak formları: yerelde sekmeler, GitHub'da tek form (diğerinin modülleri pakete girmez). */
function SourceForms(props: SourceFormProps) {
  return __EDITION__ === 'github' ? <GithubSource {...props} /> : <SourceTabs {...props} />;
}

/**
 * initialReviewId yönlendirmesi oturumda (sayfa yüklemesi başına) yalnız bir kez yapılır. Sayfa doğrudan bir inceleme
 * adresinde açıldıysa (ör. F5) yönlendirme hiç yapılmaz: logoya tıklayınca başlangıç ekranında kalınır.
 */
let initialRedirectDone = typeof window !== 'undefined' && parseHash(window.location.hash).name !== 'home';

/** Sürüme göre kahraman metni (derleme sabitiyle dallanır; diğer sürümün metni pakete girmez). */
function Intro() {
  if (__EDITION__ === 'github') {
    return (
      <section className="home__intro">
        <h1 className="home__title">
          Uzak değişikliği <em>yerelde</em>, sembol sembol okuyun.
        </h1>
        <p className="home__lead">
          Bir PR'ı ya da uzak depodaki bir dalı verin: Reviewist depoyu git ile bu bilgisayara klonlar ve AI ile yapılmış Java
          değişikliklerini tip ve üye düzeyinde çözümler — neyin değiştiğini, alt sınıflara ve çağıranlara nasıl yayıldığını, neye önce
          bakmanız ve neyi güvenle atlayabileceğinizi gösterir.
        </p>
      </section>
    );
  }
  return (
    <section className="home__intro">
      <h1 className="home__title">
        Büyük değişikliği <em>sembol sembol</em> okuyun.
      </h1>
      <p className="home__lead">
        Reviewist, AI ile yapılmış Java değişikliklerini tip ve üye düzeyinde çözümler: neyin değiştiğini, alt sınıflara ve
        çağıranlara nasıl yayıldığını, neye önce bakmanız ve neyi güvenle atlayabileceğinizi gösterir.{' '}
        <strong className="home__lead-mark">Depo yalnız bu bilgisayarda okunur; Reviewist Yerel ağa hiç çıkmaz.</strong>
      </p>
    </section>
  );
}

export function SourcePage() {
  const config = useConfig();
  const create = useCreateReview();
  const mock = useApiMode((s) => s.mock);
  const enableMock = useApiMode((s) => s.enableMock);
  const notice = useNotice((s) => s.notice);
  const setNotice = useNotice((s) => s.setNotice);
  const failedKind = create.variables?.kind;
  const serverError: ServerFieldError | undefined =
    create.isError && isApiError(create.error) && create.error.field && failedKind && formHasField(failedKind, create.error.field)
      ? { kind: failedKind, field: create.error.field, message: create.error.message }
      : undefined;
  const mismatch = mock ? undefined : editionMismatch(__EDITION__, config.data);
  const clearServerError = () => {
    if (create.isError) create.reset();
  };

  useEffect(() => {
    const id = config.data?.initialReviewId;
    if (id && !initialRedirectDone) {
      initialRedirectDone = true;
      // İnceleme açılamazsa (404) ReviewScreen buraya bilgi notuyla geri döner.
      useNotice.getState().markInitialAttempt(id);
      navigate({ name: 'review', id, tab: 'workspace', params: {} }, true);
    }
  }, [config.data?.initialReviewId]);

  return (
    <div className="home">
      <header className="home__bar">
        <span className="brand">
          <span className="brand__mark" aria-hidden="true">R</span>
          <span className="brand__name">{APP_NAME}</span>
          {config.data && <span className="brand__ver gauge">v{config.data.version}</span>}
        </span>
        <span className="home__spacer" />
        <MockBadge />
        <ThemeToggle />
      </header>

      <main className="home__main">
        <Intro />

        <div className="home__grid">
          <div className="home__source">
            {notice && (
              <div className="notice" role="status">
                <span className="notice__text">{notice}</span>
                <button type="button" className="icon-btn icon-btn--sm" onClick={() => setNotice(null)} aria-label="Bilgi notunu kapat" title="Kapat">
                  ×
                </button>
              </div>
            )}
            {mismatch && (
              <div className="notice notice--warn" role="alert">
                <span className="notice__text">{mismatch}</span>
              </div>
            )}
            {config.isError && !mock && (
              <ErrorPanel
                error={config.error}
                title="Sunucu yapılandırması alınamadı"
                action={
                  <button type="button" className="btn" onClick={enableMock}>
                    Örnek veriyle devam et
                  </button>
                }
              />
            )}
            {create.isPending && <AnalysisProgress progress={create.progress} onCancel={create.cancel} />}
            {/* İlerleme sırasında form gizlenir ama bağlı kalır: hata sonrası girilen değerler kaybolmaz. */}
            <div hidden={create.isPending}>
              {config.isPending ? (
                <p className="muted">Yapılandırma okunuyor…</p>
              ) : (
                <SourceForms
                  config={config.data}
                  pending={create.isPending}
                  onSubmit={(req) => {
                    setNotice(null);
                    create.mutate(req);
                  }}
                  serverError={serverError}
                  onEdit={clearServerError}
                />
              )}
              {create.isError && !serverError && <ErrorPanel error={create.error} title="Analiz başlatılamadı" />}
            </div>
          </div>
          <aside className="home__side">
            <RecentReviews />
            <div className="home__legend">
              <h2 className="section-title">Okuma işaretleri</h2>
              <ul className="legend-list">
                <li><span className="status status--signatureChanged"><span className="status__glyph">Δ</span></span> İmza değişti — çağıranları etkiler</li>
                <li><span className="status status--modified"><span className="status__glyph">~</span></span> Gövde değişti</li>
                <li><span className="status status--moved"><span className="status__glyph">→</span></span> Taşındı · <span className="status status--renamed"><span className="status__glyph">≈</span></span> yeniden adlandırıldı</li>
                <li><span className="status status--impacted"><span className="status__glyph">◌</span></span> Değişmedi ama etkileniyor</li>
                <li><span className="status status--cosmetic"><span className="status__glyph">·</span></span> Kozmetik — atlanabilir</li>
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

import { Icon } from '../../components/Icon';
import { MockBadge } from '../../components/MockBadge';
import { ThemeToggle } from '../../components/ThemeToggle';
import type { Tab } from '../../lib/route';
import { formatHash } from '../../lib/route';
import { safeHref } from '../../lib/safeHref';
import { useUi } from '../../state/uiStore';
import { ExportMenu } from './ExportMenu';
import { ProgressMeter } from './ProgressMeter';
import { useReviewCtx } from './ReviewContext';
import { SummaryChips } from './SummaryChips';
import { WarningsIndicator } from './WarningsIndicator';

const short = (sha?: string) => (sha ? sha.slice(0, 7) : undefined);

export function TopBar({ tab }: { tab: Tab }) {
  const { review, index } = useReviewCtx();
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  const s = review.source;
  const prHref = safeHref(s.prUrl);
  const counts = index.findingCounts.total;
  const errors = counts.error;
  const tabs: { id: Tab; label: string; icon: 'list' | 'graph' | 'flag'; count?: number }[] = [
    { id: 'workspace', label: 'Çalışma alanı', icon: 'list' },
    { id: 'graph', label: 'Etki haritası', icon: 'graph' },
    { id: 'findings', label: 'Bulgular', icon: 'flag', count: counts.error + counts.warning },
  ];

  return (
    <header className="topbar">
      <div className="topbar__row">
        <a className="brand brand--small" href={formatHash({ name: 'home' })} title="Başlangıç ekranına dön">
          <span className="brand__mark" aria-hidden="true">R</span>
          <span className="sr-only">Reviewist başlangıç</span>
        </a>
        <div className="topbar__title">
          <h1 className="topbar__h1" title={s.title}>
            {s.title}
          </h1>
          <p className="topbar__refs">
            <span className="ref">{s.baseRef}</span>
            {short(s.baseSha) && <span className="sha">{short(s.baseSha)}</span>}
            <span className="topbar__arrow" aria-label="karşılaştırılan">→</span>
            <span className="ref ref--head">{s.headRef}</span>
            {short(s.headSha) && <span className="sha">{short(s.headSha)}</span>}
            {prHref && (
              <a className="topbar__pr" href={prHref} target="_blank" rel="noopener noreferrer">
                {s.prNumber ? `#${s.prNumber}` : 'PR'} <Icon name="external" size={11} />
              </a>
            )}
            {s.author && <span className="topbar__author">{s.author}</span>}
          </p>
        </div>
        <nav className="topbar__tabs" aria-label="İnceleme görünümleri">
          {tabs.map((t) => (
            <a
              key={t.id}
              className={`topbar__tab${tab === t.id ? ' is-active' : ''}`}
              href={formatHash({ name: 'review', id: review.id, tab: t.id, params: {} })}
              aria-current={tab === t.id ? 'page' : undefined}
              title={t.label}
            >
              <Icon name={t.icon} />
              <span className="topbar__tab-label">{t.label}</span>
              {t.count !== undefined && (
                <span className={`topbar__count${errors > 0 ? ' has-error' : ''}`} title={`${errors} hata, ${counts.warning} uyarı (${counts.info} bilgi notu ayrıca)`}>
                  {t.count}
                </span>
              )}
            </a>
          ))}
        </nav>
        <div className="topbar__tools">
          <MockBadge />
          <WarningsIndicator />
          <ExportMenu />
          <ThemeToggle />
          <button type="button" className="icon-btn" onClick={() => setHelpOpen(true)} aria-label="Klavye kısayolları" title="Klavye kısayolları (?)">
            <Icon name="help" />
          </button>
        </div>
      </div>
      <div className="topbar__row topbar__row--gauges">
        <SummaryChips />
        <ProgressMeter />
      </div>
    </header>
  );
}

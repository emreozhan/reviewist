import { Icon } from '../../components/Icon';
import { RiskBadge } from '../../components/RiskBadge';
import { StatusGlyph } from '../../components/StatusGlyph';
import { linkProps } from '../../hooks/useCodeNav';
import { KIND_LABEL } from '../../lib/labels';
import type { PeekEntry } from '../../lib/peekStack';
import { baseName, dirName } from '../../lib/reviewIndex';
import type { PeekMeta } from './peekMeta';
import { BG_CLICK } from '../../lib/openIntent';

interface PeekHeaderProps {
  entry: PeekEntry;
  level: number;
  active: boolean;
  meta: PeekMeta;
  /** Yalnız üstteki pencerede: tüm yığının kırıntı izi. */
  crumbs: PeekEntry[] | null;
  titleId: string;
  onOpenTab: (background: boolean) => void;
  onToggleMax: () => void;
  onClose: () => void;
  onReturn: (level: number) => void;
  onCloseAll: () => void;
}

/** Pencere başlığı: seviye rozeti, sembol, durum, risk, dosya; düğmeler; üstteki pencerede kırıntı izi. */
export function PeekHeader({ entry, level, active, meta, crumbs, titleId, onOpenTab, onToggleMax, onClose, onReturn, onCloseAll }: PeekHeaderProps) {
  const path = entry.target.path;
  const dir = dirName(path);
  return (
    <>
      <div className="peek__bar">
        <span className="peek__lvl" title={`Gözatma seviyesi ${level + 1}`} aria-hidden="true">
          {level + 1}
        </span>
        <StatusGlyph status={meta.status} />
        <h3 className="peek__title" id={titleId}>
          <span className="peek__type">{meta.typeName}</span>
          {meta.memberPart && <span className="peek__member">{meta.memberPart}</span>}
          {entry.target.callSite && entry.target.line ? <span className="peek__callsite"> · çağrı satırı {entry.target.line}</span> : null}
        </h3>
        <span className={`peek__status${meta.changed ? ' is-changed' : ''}`}>{meta.statusText}</span>
        {meta.risk && <RiskBadge level={meta.risk.level} score={meta.risk.score} compact />}
        <span className="peek__spacer" />
        {!active && <span className="peek__back-hint">↩ tıkla: bu seviyeye dön</span>}
        <button type="button" className="btn btn--sm btn--ghost peek__btn" title={`Sekmede aç (${BG_CLICK}: arka plan sekmesi)`} {...linkProps(onOpenTab)}>
          <Icon name="tabs" /> Sekmede aç
        </button>
        <button
          type="button"
          className={`icon-btn icon-btn--sm peek__icon${entry.maximized ? ' is-on' : ''}`}
          aria-pressed={entry.maximized}
          title={entry.maximized ? 'Basamaklı konuma dön' : 'Büyüt: orta paneli kapla'}
          aria-label={entry.maximized ? 'Küçült' : 'Büyüt'}
          onClick={onToggleMax}
        >
          <Icon name={entry.maximized ? 'shrink' : 'focus'} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm peek__icon" title="Kapat (Esc)" aria-label="Pencereyi kapat" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="peek__sub">
        {meta.kind && <span className="peek__kind">{KIND_LABEL[meta.kind]}</span>}
        {meta.signature && (
          <code className="peek__sig" title={meta.signature}>
            {meta.signature}
          </code>
        )}
        <span className="peek__path" title={path}>
          {dir && <span className="peek__dir">{dir}</span>}
          {dir && <span aria-hidden="true">/</span>}
          <span className="peek__base">{baseName(path)}</span>
          {!entry.target.inDiff && <span className="tag tag--outside peek__tag">{entry.target.side === 'old' ? 'eski sürüm' : 'diff dışı'}</span>}
        </span>
      </div>
      {crumbs && crumbs.length > 1 && (
        <nav className="peek__crumbs" aria-label="Gözatma zinciri" data-nodrag>
          <ol>
            {crumbs.map((c, i) => (
              <li key={c.uid}>
                {i > 0 && <span className="peek__arrow" aria-hidden="true">→</span>}
                {i === crumbs.length - 1 ? (
                  <span className="peek__crumb is-current" aria-current="true">
                    {c.crumb}
                  </span>
                ) : (
                  <button type="button" className="peek__crumb" title={`${i + 1}. seviyeye dön (üstündekiler kapanır)`} onClick={() => onReturn(i)}>
                    {c.crumb}
                  </button>
                )}
              </li>
            ))}
          </ol>
          <button type="button" className="link-btn peek__closeall" onClick={onCloseAll}>
            Tümünü kapat
          </button>
        </nav>
      )}
    </>
  );
}

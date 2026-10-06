import type { Finding } from '../../../../src/shared/types';
import { SymbolLink } from '../../components/SymbolLink';
import { linkProps } from '../../hooks/useCodeNav';
import { useOpenLocation } from '../../hooks/useNavigation';
import { CATEGORY_LABEL } from '../../lib/selectors';
import { SEVERITY_LABEL } from '../../lib/labels';
import { baseName, symbolLabel } from '../../lib/reviewIndex';
import { useReviewCtx } from '../workspace/ReviewContext';
import { BG_CLICK } from '../../lib/openIntent';

interface FindingCardProps {
  finding: Finding;
  compact?: boolean;
  showCategory?: boolean;
}

/** Bulgu kartı: önem işareti (şekil + renk), başlık, açıklama, konum düğmesi. */
export function FindingCard({ finding, compact = false, showCategory = false }: FindingCardProps) {
  const open = useOpenLocation();
  const { index } = useReviewCtx();
  const symbols = (finding.symbolIds ?? []).slice(0, 4);
  const loc = finding.file ? `${baseName(finding.file)}${finding.line ? `:${finding.line}` : ''}` : null;
  const canOpen = !!finding.file || (finding.symbolIds?.length ?? 0) > 0;

  return (
    <article className={`fcard sev--${finding.severity}${compact ? ' fcard--compact' : ''}`}>
      <header className="fcard__head">
        <span className={`sev-mark sev-mark--${finding.severity}`} aria-hidden="true" />
        <span className="fcard__sev">{SEVERITY_LABEL[finding.severity]}</span>
        {showCategory && <span className="tag">{CATEGORY_LABEL[finding.category]}</span>}
        <h4 className="fcard__title">{finding.title}</h4>
      </header>
      {!compact && <p className="fcard__msg">{finding.message}</p>}
      {!compact && symbols.length > 0 && (
        <p className="fcard__syms" aria-label="İlgili semboller">
          {symbols.map((id) => (
            <SymbolLink
              key={id}
              id={id}
              label={symbolLabel(index, id)}
              status={index.memberById.get(id)?.status ?? index.typeById.get(id)?.status ?? (index.nodeById.has(id) ? 'impacted' : undefined)}
              className="slink--chip"
            />
          ))}
          {(finding.symbolIds?.length ?? 0) > symbols.length && <span className="muted">+{(finding.symbolIds?.length ?? 0) - symbols.length}</span>}
        </p>
      )}
      {canOpen && (
        <button
          type="button"
          className="fcard__loc"
          title={`Konumu sekmede aç (${BG_CLICK}: arka planda)`}
          {...linkProps((background) => open({ file: finding.file, line: finding.line, symbolIds: finding.symbolIds }, { background }))}
        >
          {loc ?? 'İlgili sembole git'} <span aria-hidden="true">›</span>
        </button>
      )}
    </article>
  );
}

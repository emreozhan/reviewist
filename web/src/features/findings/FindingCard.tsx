import type { Finding } from '../../../../src/shared/types';
import { useOpenLocation } from '../../hooks/useNavigation';
import { CATEGORY_LABEL } from '../../lib/selectors';
import { SEVERITY_LABEL } from '../../lib/labels';
import { baseName } from '../../lib/reviewIndex';

interface FindingCardProps {
  finding: Finding;
  compact?: boolean;
  showCategory?: boolean;
}

/** Bulgu kartı: önem işareti (şekil + renk), başlık, açıklama, konum düğmesi. */
export function FindingCard({ finding, compact = false, showCategory = false }: FindingCardProps) {
  const open = useOpenLocation();
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
      {canOpen && (
        <button type="button" className="fcard__loc" onClick={() => open({ file: finding.file, line: finding.line, symbolIds: finding.symbolIds })}>
          {loc ?? 'İlgili sembole git'} <span aria-hidden="true">›</span>
        </button>
      )}
    </article>
  );
}

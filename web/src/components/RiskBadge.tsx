import type { RiskLevel } from '../../../src/shared/types';
import { RISK_BARS, RISK_LABEL } from '../lib/labels';

interface RiskBadgeProps {
  level: RiskLevel;
  score?: number;
  /** Kompakt: yalnız çubuklar. */
  compact?: boolean;
}

/** Dört çubuklu risk ölçeği: renk + doluluk birlikte anlam taşır. */
export function RiskBadge({ level, score, compact = false }: RiskBadgeProps) {
  const filled = RISK_BARS[level];
  const label = `Risk: ${RISK_LABEL[level]}${score !== undefined ? ` (${score}/100)` : ''}`;
  return (
    <span className={`risk risk--${level}${compact ? ' risk--compact' : ''}`} title={label} aria-label={label} role="img">
      <span className="risk__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`risk__bar${i <= filled ? ' is-on' : ''}`} style={{ height: `${3 + i * 2}px` }} />
        ))}
      </span>
      {!compact && <span className="risk__text" aria-hidden="true">{RISK_LABEL[level]}{score !== undefined ? ` ${score}` : ''}</span>}
    </span>
  );
}

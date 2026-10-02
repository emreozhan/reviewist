import type { RiskInfo } from '../../../../src/shared/types';
import { RiskBadge } from '../../components/RiskBadge';

/** Risk nedenleri puanlarıyla; çubuk uzunluğu toplam skora katkıyı gösterir. */
export function RiskReasons({ risk }: { risk: RiskInfo }) {
  if (risk.reasons.length === 0) return null;
  const sorted = [...risk.reasons].sort((a, b) => b.weight - a.weight);
  const max = Math.max(...sorted.map((r) => r.weight), 1);
  return (
    <section className="insp__sec" aria-labelledby="risk-title">
      <h3 id="risk-title" className="insp__h">
        Risk <RiskBadge level={risk.level} score={risk.score} />
      </h3>
      <ul className="reasons">
        {sorted.map((r, i) => (
          <li key={`${r.code}-${i}`} className="reason" title={r.code}>
            <span className="reason__w">
              <span className="gauge">+{r.weight}</span>
              <span className={`reason__bar risk-fill--${risk.level}`} style={{ width: `${(r.weight / max) * 100}%` }} aria-hidden="true" />
            </span>
            <span className="reason__msg">{r.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

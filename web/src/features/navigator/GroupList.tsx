import { RiskBadge } from '../../components/RiskBadge';
import { passesFilters, RISK_RANK } from '../../lib/selectors';
import { findAnchor, symbolLabel } from '../../lib/reviewIndex';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FileRow } from './FileRow';

/** Mantıksal değişiklik kümeleri ("hikâyeler"), riske göre sıralı. */
export function GroupList() {
  const { review, index } = useReviewCtx();
  const filters = useUi((s) => s.filters);
  const selectSymbol = useUi((s) => s.selectSymbol);
  const groups = [...review.groups].sort((a, b) => RISK_RANK[b.riskLevel] - RISK_RANK[a.riskLevel]);

  if (groups.length === 0) return <p className="nav__empty">Analiz grup üretmedi.</p>;

  return (
    <ul className="groups">
      {groups.map((g) => {
        const files = g.fileIds
          .map((id) => index.fileById.get(id))
          .filter((f): f is NonNullable<typeof f> => !!f && passesFilters(f, index, filters));
        const outside = g.symbolIds.filter((id) => !index.symbolFile.has(id));
        if (files.length === 0 && filters.query) return null;
        return (
          <li key={g.id} className={`group risk-edge--${g.riskLevel}`}>
            <div className="group__head">
              <h3 className="group__title">{g.title}</h3>
              <RiskBadge level={g.riskLevel} compact />
            </div>
            <p className="group__desc">{g.description}</p>
            <div className="group__files">
              {files.map((f) => (
                <FileRow key={f.id} file={f} compact />
              ))}
            </div>
            {outside.length > 0 && (
              <p className="group__outside">
                <span className="status status--impacted"><span className="status__glyph" aria-hidden="true">◌</span></span>
                Diff dışı:{' '}
                {outside.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ', '}
                    <button type="button" className="link-btn" title="Bu sembolü etkileyen değişikliğe git" onClick={() => {
                      const via = findAnchor(index, id) ?? g.symbolIds.find((s) => index.symbolFile.has(s));
                      if (via) selectSymbol(via, index.symbolFile.get(via));
                    }}>
                      {symbolLabel(index, id)}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

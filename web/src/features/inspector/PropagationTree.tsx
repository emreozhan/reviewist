import { propagationFor } from '../../lib/propagation';
import { useReviewCtx } from '../workspace/ReviewContext';
import { PropagationItem } from './PropagationItem';

/** Denetçinin kritik bölümü: "Bu değişiklik nereye gidiyor?" */
export function PropagationTree({ symbolId }: { symbolId: string }) {
  const { index } = useReviewCtx();
  const sections = propagationFor(index, symbolId);
  const outside = sections.filter((s) => s.outside).reduce((n, s) => n + s.items.length, 0)
    + sections.filter((s) => !s.outside).flatMap((s) => s.items).filter((i) => !i.inDiff).length;

  return (
    <section className="insp__sec prop-tree" aria-labelledby="prop-title">
      <h3 id="prop-title" className="insp__h">
        Bu değişiklik nereye gidiyor?
        {outside > 0 && <span className="prop-tree__out" title="Değişmediği halde etkilenen semboller">◌ {outside} diff dışı</span>}
      </h3>
      {sections.length === 0 ? (
        <p className="muted">Bilinen çağıran, alt tip ya da override yok; etki bu sembolle sınırlı görünüyor.</p>
      ) : (
        sections.map((s) => (
          <div key={s.id} className={`prop-tree__group${s.outside ? ' is-outside' : ''}`}>
            <p className="prop-tree__title">
              <span className="prop-tree__glyph" aria-hidden="true">{s.glyph}</span>
              {s.title}
              <span className="gauge prop-tree__count">{s.items.length}</span>
            </p>
            <ul className="prop-tree__list">
              {s.items.map((item) => (
                <PropagationItem key={item.key} item={item} isCall={s.id === 'callersIn' || s.id === 'callersOut'} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

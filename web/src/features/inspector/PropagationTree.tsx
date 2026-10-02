import { useMemo, useState } from 'react';
import type { PropSection } from '../../lib/propagation';
import { propagationFor } from '../../lib/propagation';
import { useReviewCtx } from '../workspace/ReviewContext';
import { PropagationItem } from './PropagationItem';

/** Bölüm başına ilk çizilen öğe sayısı; fazlası "daha fazla" ile açılır. */
const PAGE = 40;

function SectionBlock({ s }: { s: PropSection }) {
  const [showUnverified, setShowUnverified] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const isCall = s.id === 'callersIn' || s.id === 'callersOut';
  const all = showUnverified ? [...s.items, ...s.unverified] : s.items;
  const shown = all.slice(0, limit);
  const likely = s.items.filter((i) => i.confidence === 'likely').length;

  return (
    <div className={`prop-tree__group${s.outside ? ' is-outside' : ''}`}>
      <p className="prop-tree__title">
        <span className="prop-tree__glyph" aria-hidden="true">{s.glyph}</span>
        {s.title}
        <span className="gauge prop-tree__count">{s.items.length}</span>
        {likely > 0 && (
          <span className="prop-tree__likely" title="Alıcı tipi kesin çözülemedi; overload/arity ile eşlendi. Doğrulayın.">
            {likely} olası
          </span>
        )}
      </p>
      {shown.length > 0 && (
        <ul className="prop-tree__list">
          {shown.map((item) => (
            <PropagationItem key={item.key} item={item} isCall={isCall} />
          ))}
        </ul>
      )}
      {all.length > shown.length && (
        <button type="button" className="prop-tree__more" onClick={() => setLimit((l) => l + PAGE * 5)}>
          {Math.min(PAGE * 5, all.length - shown.length)} tane daha göster ({all.length - shown.length} gizli)
        </button>
      )}
      {s.unverified.length > 0 && (
        <button
          type="button"
          className="prop-tree__unverified"
          aria-expanded={showUnverified}
          onClick={() => setShowUnverified((v) => !v)}
          title="Yalnız ad eşleşmesi: alıcı tipi çözülemedi; çoğu başka bir sınıfın aynı adlı metodudur."
        >
          {showUnverified ? 'Doğrulanamamış eşleşmeleri gizle' : `+${s.unverified.length} doğrulanamamış eşleşme`}
        </button>
      )}
    </div>
  );
}

/** Denetçinin kritik bölümü: "Bu değişiklik nereye gidiyor?" */
export function PropagationTree({ symbolId }: { symbolId: string }) {
  const { index } = useReviewCtx();
  const sections = useMemo(() => propagationFor(index, symbolId), [index, symbolId]);
  const outside = sections.reduce((n, s) => n + (s.outside ? s.items.length : s.items.filter((i) => !i.inDiff).length), 0);

  return (
    <section className="insp__sec prop-tree" aria-labelledby="prop-title">
      <h3 id="prop-title" className="insp__h">
        Bu değişiklik nereye gidiyor?
        {outside > 0 && <span className="prop-tree__out" title="Değişmediği halde etkilenen semboller (doğrulanamamış eşleşmeler hariç)">◌ {outside} diff dışı</span>}
      </h3>
      {sections.length === 0 ? (
        <p className="muted">Bilinen çağıran, alt tip ya da override yok; etki bu sembolle sınırlı görünüyor.</p>
      ) : (
        sections.map((s) => <SectionBlock key={s.id} s={s} />)
      )}
    </section>
  );
}

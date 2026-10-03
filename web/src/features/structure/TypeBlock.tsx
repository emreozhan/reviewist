import type { FileChange, TypeChange } from '../../../../src/shared/types';
import { PropagationBadges } from '../../components/PropagationBadges';
import { RiskBadge } from '../../components/RiskBadge';
import { StatusGlyph } from '../../components/StatusGlyph';
import { JAVA_KEYWORD, KIND_LABEL } from '../../lib/labels';
import { shortId } from '../../lib/reviewIndex';
import { typeFoldKey } from '../../lib/structureRows';
import { useLayout } from '../../state/layoutStore';
import { useUi } from '../../state/uiStore';

interface TypeHeadProps {
  type: TypeChange;
  file: FileChange;
}

function superList(list: string[] | undefined): string {
  return (list ?? []).map(shortId).join(', ');
}

/**
 * Tip kartının başlığı: tür, ad, üst tipler, durum, risk ve tip düzeyi ayrıntılar. Üyeler ayrı satırlarda (StructureView).
 * Soldaki düğme üyeleri katlar/açar (durum tarayıcıda saklanır); yayılım göstergeleri menü açar.
 */
export function TypeHead({ type, file }: TypeHeadProps) {
  const selected = useUi((s) => s.selectedSymbolId === type.id);
  const selectSymbol = useUi((s) => s.selectSymbol);
  const foldKey = typeFoldKey(type.id);
  const folded = useLayout((s) => !!s.closed[foldKey]);
  const setOpen = useLayout((s) => s.setOpen);
  const supersChanged = type.oldSuperTypes && superList(type.oldSuperTypes) !== superList(type.superTypes);
  const changedMembers = type.members.filter((m) => m.status !== 'unchanged').length;

  return (
    <div className={`tblock${folded ? ' is-folded' : ''}`} aria-label={`${KIND_LABEL[type.kind]} ${type.name}`}>
      <div className="tblock__bar">
        <button
          type="button"
          className="tblock__fold"
          aria-expanded={!folded}
          aria-label={`${type.name} üyelerini ${folded ? 'göster' : 'gizle'}`}
          title={folded ? `Üyeleri göster (${changedMembers} değişen)` : 'Üyeleri katla'}
          onClick={() => setOpen(foldKey, folded)}
        >
          <span aria-hidden="true">{folded ? '▸' : '▾'}</span>
        </button>
        <button type="button" className={`tblock__head${selected ? ' is-selected' : ''}`} onClick={() => selectSymbol(type.id, file.id)}>
          <StatusGlyph status={type.status} />
          <span className="tblock__decl">
            {type.annotations.length > 0 && <span className="tblock__ann">{type.annotations.join(' ')}</span>}
            <span className="tblock__kw">{type.visibility !== 'package' ? `${type.visibility} ` : ''}{JAVA_KEYWORD[type.kind]}</span>{' '}
            <span className="tblock__name">{type.name}</span>
            {type.superTypes.length > 0 && !supersChanged && <span className="tblock__super"> : {superList(type.superTypes)}</span>}
            {supersChanged && (
              <span className="tblock__super">
                {' '}: <del>{superList(type.oldSuperTypes) || '—'}</del> → <ins>{superList(type.superTypes) || '—'}</ins>
              </span>
            )}
          </span>
          <span className="tblock__spacer" />
          {folded && changedMembers > 0 && <span className="tblock__folded gauge">{changedMembers} değişen üye katlı</span>}
          {type.risk.score > 0 && <RiskBadge level={type.risk.level} score={type.risk.score} />}
        </button>
        <PropagationBadges type={type} />
      </div>
      {type.details.length > 0 && !folded && (
        <ul className="tblock__details">
          {type.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

import type { FileChange, TypeChange } from '../../../../src/shared/types';
import { PropagationBadges } from '../../components/PropagationBadges';
import { RiskBadge } from '../../components/RiskBadge';
import { StatusGlyph } from '../../components/StatusGlyph';
import { JAVA_KEYWORD, KIND_LABEL } from '../../lib/labels';
import { shortId } from '../../lib/reviewIndex';
import { useUi } from '../../state/uiStore';

interface TypeHeadProps {
  type: TypeChange;
  file: FileChange;
}

function superList(list: string[] | undefined): string {
  return (list ?? []).map(shortId).join(', ');
}

/** Tip kartının başlığı: tür, ad, üst tipler, durum, risk ve tip düzeyi ayrıntılar. Üyeler ayrı satırlarda (StructureView). */
export function TypeHead({ type, file }: TypeHeadProps) {
  const selected = useUi((s) => s.selectedSymbolId === type.id);
  const selectSymbol = useUi((s) => s.selectSymbol);
  const supersChanged = type.oldSuperTypes && superList(type.oldSuperTypes) !== superList(type.superTypes);

  return (
    <div className="tblock" aria-label={`${KIND_LABEL[type.kind]} ${type.name}`}>
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
        <PropagationBadges type={type} />
        {type.risk.score > 0 && <RiskBadge level={type.risk.level} score={type.risk.score} />}
      </button>
      {type.details.length > 0 && (
        <ul className="tblock__details">
          {type.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

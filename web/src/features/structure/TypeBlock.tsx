import type { FileChange, TypeChange } from '../../../../src/shared/types';
import { PropagationBadges } from '../../components/PropagationBadges';
import { RiskBadge } from '../../components/RiskBadge';
import { StatusGlyph } from '../../components/StatusGlyph';
import { JAVA_KEYWORD, KIND_LABEL, STATUS_ORDER } from '../../lib/labels';
import { shortId } from '../../lib/reviewIndex';
import { useUi } from '../../state/uiStore';
import { MemberRow } from './MemberRow';

interface TypeBlockProps {
  type: TypeChange;
  file: FileChange;
}

function superList(list: string[] | undefined): string {
  return (list ?? []).map(shortId).join(', ');
}

/** Tip iskeleti: başlık (tür, ad, üst tipler, durum, risk) ve üyeler; değişmeyen üyeler soluk ve katlı. */
export function TypeBlock({ type, file }: TypeBlockProps) {
  const showUnchanged = useUi((s) => s.showUnchanged);
  const toggleUnchanged = useUi((s) => s.toggleShowUnchanged);
  const selected = useUi((s) => s.selectedSymbolId === type.id);
  const selectSymbol = useUi((s) => s.selectSymbol);

  const changed = type.members.filter((m) => m.status !== 'unchanged');
  const unchangedCount = type.members.length - changed.length;
  const sortedChanged = [...changed].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.risk.score - a.risk.score);
  // Değişmeyenler gösterilince kaynak sırasına dön (iskelet okuması); gizliyken önem sırası.
  const startOf = (m: (typeof type.members)[number]) => (m.newRange ?? m.oldRange)?.startLine ?? 0;
  const members = showUnchanged ? [...type.members].sort((a, b) => startOf(a) - startOf(b)) : sortedChanged;
  const supersChanged = type.oldSuperTypes && superList(type.oldSuperTypes) !== superList(type.superTypes);

  return (
    <section className={`tblock st-line--${type.status}`} aria-label={`${KIND_LABEL[type.kind]} ${type.name}`}>
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
      <ul className="tblock__members">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} file={file} />
        ))}
      </ul>
      {unchangedCount > 0 && (
        <button type="button" className="tblock__more" aria-pressed={showUnchanged} onClick={toggleUnchanged}>
          {showUnchanged ? 'Değişmeyen üyeleri gizle' : `Değişmeyen ${unchangedCount} üyeyi göster`}
        </button>
      )}
    </section>
  );
}

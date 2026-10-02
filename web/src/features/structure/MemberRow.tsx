import type { FileChange, MemberChange } from '../../../../src/shared/types';
import { PropagationBadges } from '../../components/PropagationBadges';
import { RiskBadge } from '../../components/RiskBadge';
import { SignatureDiff } from '../../components/SignatureDiff';
import { StatusGlyph } from '../../components/StatusGlyph';
import { KIND_LABEL, STATUS_META } from '../../lib/labels';
import { symbolLabel } from '../../lib/reviewIndex';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { MemberDiff } from './MemberDiff';

interface MemberRowProps {
  member: MemberChange;
  file: FileChange;
}

/** İskelette bir üye: durum, imza farkı, ayrıntılar, risk ve yayılım; seçilince üye odaklı diff açılır. Görünür alana getirmeyi liste yapar. */
export function MemberRow({ member, file }: MemberRowProps) {
  const { index } = useReviewCtx();
  const selected = useUi((s) => s.selectedSymbolId === member.id);
  const selectSymbol = useUi((s) => s.selectSymbol);
  const movedTo = member.status === 'moved' && !member.newRange ? index.membersByOldId.get(member.id)?.[0] : undefined;
  const lines = member.newRange ?? member.oldRange;

  return (
    <div className={`member st-line--${member.status}${selected ? ' is-selected' : ''}${member.status === 'unchanged' ? ' is-unchanged' : ''}`}>
      <button
        type="button"
        className="member__btn"
        aria-expanded={member.status === 'unchanged' ? undefined : selected}
        onClick={() => selectSymbol(selected ? null : member.id, file.id)}
      >
        <span className="member__head">
          <StatusGlyph status={member.status} />
          <span className="member__kind">{KIND_LABEL[member.kind]}</span>
          <SignatureDiff signature={member.signature} oldSignature={member.oldSignature} />
          <span className="member__spacer" />
          {(member.linesAdded > 0 || member.linesRemoved > 0) && (
            <span className="member__lines gauge" title="Bu üyede eklenen/silinen satır">
              <span className="delta__add">+{member.linesAdded}</span> <span className="delta__del">−{member.linesRemoved}</span>
            </span>
          )}
          {member.status !== 'unchanged' && member.risk.score > 0 && <RiskBadge level={member.risk.level} score={member.risk.score} compact />}
        </span>
        {member.status !== 'unchanged' && (
          <span className="member__sub">
            <span className="member__status">{STATUS_META[member.status].label}</span>
            {member.oldName && member.oldName !== member.name && <span className="member__was">eski adı: {member.oldName}</span>}
            {movedTo && <span className="member__was">→ {symbolLabel(index, movedTo.id)}</span>}
            {lines && <span className="member__loc gauge">satır {lines.startLine}–{lines.endLine}</span>}
            <PropagationBadges member={member} />
          </span>
        )}
        {member.details.length > 0 && member.status !== 'unchanged' && (
          <span className="member__details">
            {member.details.map((d) => (
              <span key={d} className="member__detail">
                {d}
              </span>
            ))}
          </span>
        )}
      </button>
      {selected && member.status !== 'unchanged' && <MemberDiff file={file} member={member} />}
    </div>
  );
}

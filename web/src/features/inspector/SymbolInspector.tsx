import { Section } from '../../components/Section';
import { SignatureDiff } from '../../components/SignatureDiff';
import { StatusGlyph } from '../../components/StatusGlyph';
import { FLAG_LABEL, KIND_LABEL, STATUS_META } from '../../lib/labels';
import { symbolNoteKey } from '../../lib/persistence';
import { baseName, symbolTail } from '../../lib/reviewIndex';
import { FindingCard } from '../findings/FindingCard';
import { useReviewCtx } from '../workspace/ReviewContext';
import { NoteEditor } from './NoteEditor';
import { PropagationTree } from './PropagationTree';
import { RiskReasons } from './RiskReasons';

/** Seçili tip ya da üye için denetçi içeriği. */
export function SymbolInspector({ symbolId }: { symbolId: string }) {
  const { index } = useReviewCtx();
  const member = index.memberById.get(symbolId);
  const type = member ? index.typeById.get(member.ownerTypeId) : index.typeById.get(symbolId);
  const subject = member ?? type;
  if (!subject) return <p className="muted insp__empty">Sembol bu incelemede bulunamadı.</p>;

  const file = index.symbolFile.get(symbolId);
  const range = subject.newRange ?? subject.oldRange;
  const findings = index.findingsBySymbol.get(symbolId) ?? [];
  const groups = index.groupsBySymbol.get(symbolId) ?? [];
  const signature = member ? member.signature : undefined;

  return (
    <div className="insp__content">
      <header className="insp__subject">
        <p className="insp__kind">
          {KIND_LABEL[subject.kind]}
          {member && type && <> · <span className="insp__owner">{type.name}</span></>}
        </p>
        <h2 className="insp__name">{member ? symbolTail(index, symbolId) : subject.name}</h2>
        <p className="insp__where">
          <StatusGlyph status={subject.status} withLabel />
          {file && (
            <span className="insp__file gauge">
              {baseName(file)}
              {range ? `:${range.startLine}` : ''}
            </span>
          )}
        </p>
        {groups.length > 0 && (
          <p className="insp__groups">
            {groups.map((g) => (
              <span key={g.id} className={`tag risk-text--${g.riskLevel}`} title={g.description}>
                {g.title}
              </span>
            ))}
          </p>
        )}
      </header>

      {signature && (
        <Section id="insp.signature" title="İmza">
          <SignatureDiff signature={signature} oldSignature={member?.oldSignature} stacked />
        </Section>
      )}

      {(subject.details.length > 0 || subject.flags.length > 0) && (
        <Section id="insp.changes" title="Ne değişti">
          {subject.flags.length > 0 && (
            <p className="insp__flags">
              {subject.flags.map((f) => (
                <span key={f} className="tag">
                  {FLAG_LABEL[f]}
                </span>
              ))}
            </p>
          )}
          <ul className="insp__details">
            {subject.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          {subject.status === 'unchanged' && <p className="muted">{STATUS_META.unchanged.label}.</p>}
        </Section>
      )}

      <RiskReasons risk={subject.risk} />
      <PropagationTree symbolId={symbolId} />

      {findings.length > 0 && (
        <Section id="insp.findings" title="Bu sembolle ilgili bulgular" resizable resizeLabel="Bulgular bölümü yüksekliği" extra={<span className="gauge prop-tree__count">{findings.length}</span>}>
          <div className="insp__findings">
            {findings.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        </Section>
      )}

      <NoteEditor noteKey={symbolNoteKey(symbolId)} label="Sembol notu" />
    </div>
  );
}

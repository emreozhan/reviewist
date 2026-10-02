import { memo } from 'react';
import type { SplitSide } from '../../lib/diffPresentation';
import { lineHtml } from '../../lib/diffPresentation';
import type { HlLang } from '../../lib/highlight';
import { DiffCode } from './DiffCode';

interface SplitSideCellsProps {
  side?: SplitSide;
  which: 'old' | 'new';
  lang: HlLang | null;
  oldHl: string[] | null;
  newHl: string[] | null;
}

/** Yan yana diff'in bir tarafı: satır no + kod hücresi. */
function SplitSideCellsInner({ side, which, lang, oldHl, newHl }: SplitSideCellsProps) {
  if (!side) {
    return (
      <>
        <td className="dl__no dl__no--empty" />
        <td className="dl__code dl__code--empty" />
      </>
    );
  }
  const { line } = side;
  const no = which === 'old' ? line.oldNo : line.newNo;
  const cls = line.type === 'context' ? 'ctx' : line.type;
  return (
    <>
      <td className={`dl__no dl__no--${cls}`}>{no ?? ''}</td>
      <td className={`dl__code dl__code--${cls}`}>
        <span className="sr-only">{line.type === 'add' ? 'eklendi: ' : line.type === 'del' ? 'silindi: ' : ''}</span>
        <DiffCode line={line} lang={lang} segments={side.segments} html={lineHtml(line, oldHl, newHl)} />
      </td>
    </>
  );
}

export const SplitSideCells = memo(SplitSideCellsInner);

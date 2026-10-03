import { memo } from 'react';
import type { SplitSide } from '../../lib/diffPresentation';
import { lineHtml } from '../../lib/diffPresentation';
import type { HlLang } from '../../lib/highlight';
import type { RefSpan } from '../../lib/refMerge';
import { DiffCode } from './DiffCode';

interface SplitSideCellsProps {
  side?: SplitSide;
  which: 'old' | 'new';
  lang: HlLang | null;
  oldHl: string[] | null;
  newHl: string[] | null;
  /** Yeni taraftaki tıklanabilir referanslar. */
  refSpans?: RefSpan[];
}

/** Yan yana diff'in bir tarafı: satır no + kod hücresi. */
function SplitSideCellsInner({ side, which, lang, oldHl, newHl, refSpans }: SplitSideCellsProps) {
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
        <DiffCode line={line} lang={lang} segments={side.segments} html={lineHtml(line, oldHl, newHl)} refSpans={which === 'new' ? refSpans : undefined} />
      </td>
    </>
  );
}

export const SplitSideCells = memo(SplitSideCellsInner);

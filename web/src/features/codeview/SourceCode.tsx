import { memo, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { PadRow } from '../diff/PadRow';
import { useRowWindow } from '../diff/useRowWindow';
import { escapeHtml } from '../../lib/highlight';
import type { RefSpan } from '../../lib/refMerge';
import { injectRefs } from '../../lib/refMerge';

interface SourceCodeProps {
  lines: readonly string[];
  hl: readonly string[] | null;
  spans: Map<number, RefSpan[]> | null;
  /** Odak satırı (kaydırılıp vurgulanır); tick değişince yeniden. */
  focus: { line: number; tick: number } | null;
  /** Odak sembolün bildirim aralığı (hafif vurgu). */
  range?: { startLine: number; endLine: number };
  label: string;
  handlers?: {
    onClick: (e: MouseEvent) => void;
    onAuxClick: (e: MouseEvent) => void;
    onMouseDown: (e: MouseEvent) => void;
  };
}

interface RowProps {
  n: number;
  vi: number;
  html: string;
  spans?: RefSpan[];
  mark: '' | 'target' | 'range';
}

const SourceRow = memo(function SourceRow({ n, vi, html, spans, mark }: RowProps) {
  const markup = useMemo(() => (spans && spans.length > 0 ? injectRefs(html, spans) : html), [html, spans]);
  return (
    <tr data-vi={vi} className={`sv__line${mark ? ` is-${mark}` : ''}`}>
      <td className="sv__no">{n}</td>
      <td className="sv__code">
        <code className="hl" dangerouslySetInnerHTML={{ __html: markup || ' ' }} />
      </td>
    </tr>
  );
});

const COLS = 2;

/** Salt okunur tam kaynak: sözdizimi renkli, pencereli (büyük dosya), tıklanabilir referanslı. */
export function SourceCode({ lines, hl, spans, focus, range, label, handlers }: SourceCodeProps) {
  const items = useMemo(() => lines.map((_, i) => ({ key: String(i), kind: 'line' })), [lines]);
  const focusAt = useMemo(() => (focus && focus.line >= 1 && focus.line <= lines.length ? { index: focus.line - 1, tick: focus.tick } : null), [focus, lines.length]);
  const win = useRowWindow(items, focusAt);

  const rows = [];
  for (let i = win.start; i < win.end; i++) {
    const n = i + 1;
    const mark = focus?.line === n ? 'target' : range && n >= range.startLine && n <= range.endLine ? 'range' : '';
    rows.push(<SourceRow key={n} n={n} vi={i} html={hl?.[i] ?? escapeHtml(lines[i] ?? '')} spans={spans?.get(n)} mark={mark} />);
  }

  return (
    <div className={`code-surface sv__surface${spans ? ' has-refs' : ''}`} {...handlers}>
      <table className="dt sv__table" aria-label={label} aria-rowcount={win.windowed ? lines.length : undefined}>
        <colgroup>
          <col className="dt__c-no" />
          <col />
        </colgroup>
        <tbody ref={win.bodyRef}>
          <PadRow height={win.padTop} colSpan={COLS} />
          {rows}
          <PadRow height={win.padBottom} colSpan={COLS} />
        </tbody>
      </table>
    </div>
  );
}

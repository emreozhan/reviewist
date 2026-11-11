import { memo } from 'react';
import type { DiffLine } from '../../../../src/shared/types';
import type { HlLang } from '../../lib/highlight';
import { highlightFragment } from '../../lib/highlight';
import type { RefSpan } from '../../lib/refMerge';
import { injectRefs } from '../../lib/refMerge';
import type { Segment } from '../../lib/wordDiff';

interface DiffCodeProps {
  line: DiffLine;
  lang: HlLang | null;
  segments?: Segment[];
  /** Dosya bağlamıyla renklendirilmiş hazır HTML (varsa). */
  html?: string;
  /** Koddaki tıklanabilir referanslar (yalnız yeni taraf satırlarında). */
  refSpans?: RefSpan[];
}

/**
 * Kod hücresi. HTML yalnızca highlight.js çıktısından (kaçışlanmış) ya da escapeHtml'den gelir;
 * kelime farkı parçaları <mark> ile sarılır; referanslar `span.xref` ile.
 */
function DiffCodeInner({ line, lang, segments, html, refSpans }: DiffCodeProps) {
  let markup: string;
  if (segments) {
    const cls = line.type === 'del' ? 'wd wd--del' : 'wd wd--add';
    markup = segments.map((s) => (s.changed ? `<mark class="${cls}">${highlightFragment(s.text, lang)}</mark>` : highlightFragment(s.text, lang))).join('');
  } else {
    markup = html ?? highlightFragment(line.text, lang);
  }
  // Referanslar renk/kelime farkı işaretlemesinin üstüne, metin konumuna göre yerleştirilir.
  if (refSpans && refSpans.length > 0) markup = injectRefs(markup, refSpans);
  return <code className="hl" dangerouslySetInnerHTML={{ __html: markup || ' ' }} />;
}

/** Pencerelemede kaydırırken değişmeyen satırların renklendirmesi yeniden yapılmasın diye memo. */
export const DiffCode = memo(DiffCodeInner);

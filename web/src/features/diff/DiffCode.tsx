import type { DiffLine } from '../../../../src/shared/types';
import type { HlLang } from '../../lib/highlight';
import { highlightFragment } from '../../lib/highlight';
import type { Segment } from '../../lib/wordDiff';

interface DiffCodeProps {
  line: DiffLine;
  lang: HlLang | null;
  segments?: Segment[];
  /** Dosya bağlamıyla renklendirilmiş hazır HTML (varsa). */
  html?: string;
}

/**
 * Kod hücresi. HTML yalnızca highlight.js çıktısından (kaçışlanmış) ya da escapeHtml'den gelir;
 * kelime farkı parçaları <mark> ile sarılır.
 */
export function DiffCode({ line, lang, segments, html }: DiffCodeProps) {
  let markup: string;
  if (segments) {
    const cls = line.type === 'del' ? 'wd wd--del' : 'wd wd--add';
    markup = segments.map((s) => (s.changed ? `<mark class="${cls}">${highlightFragment(s.text, lang)}</mark>` : highlightFragment(s.text, lang))).join('');
  } else {
    markup = html ?? highlightFragment(line.text, lang);
  }
  return <code className="hl" dangerouslySetInnerHTML={{ __html: markup || ' ' }} />;
}

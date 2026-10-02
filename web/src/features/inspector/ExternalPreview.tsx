import { useFileContent } from '../../hooks/queries';
import { highlightFragment, langFor } from '../../lib/highlight';
import { useReviewCtx } from '../workspace/ReviewContext';

interface ExternalPreviewProps {
  file: string;
  line?: number;
  search?: string;
  context?: number;
}

/** Diff dışındaki dosyadan head içeriğinin ilgili satırı ±3 önizlemesi (sunucunun /file ucuyla). */
export function ExternalPreview({ file, line, search, context = 3 }: ExternalPreviewProps) {
  const { review } = useReviewCtx();
  const q = useFileContent(review.id, file, 'new');
  const lang = langFor(file.endsWith('.java') ? 'java' : 'other');

  if (q.isPending) return <p className="xprev__state">Önizleme yükleniyor…</p>;
  if (q.isError) return <p className="xprev__state">Önizleme alınamadı: {q.error.message}</p>;
  if (!q.lines) return <p className="xprev__state">Dosya içeriği sunucudan alınamadı (kaynak içerik vermiyor olabilir).</p>;

  let target = line;
  if (!target && search) {
    const name = search.replace(/\($/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declRe = new RegExp(`\\b(class|interface|enum|record)\\s+${name}\\b`);
    const idx = q.lines.findIndex((l) => declRe.test(l) || (search.endsWith('(') && l.includes(search) && !l.trim().startsWith('//')));
    target = idx >= 0 ? idx + 1 : undefined;
  }
  if (!target) return <p className="xprev__state">İlgili satır bulunamadı.</p>;

  const start = Math.max(1, target - context);
  const end = Math.min(q.lines.length, target + context);
  const slice = q.lines.slice(start - 1, end);

  return (
    <div className="xprev" role="region" aria-label={`${file} satır ${target} önizlemesi (diff dışı, değişmedi)`}>
      <pre className="xprev__code">
        {slice.map((text, i) => {
          const n = start + i;
          return (
            <span key={n} className={`xprev__line${n === target ? ' is-target' : ''}`}>
              <span className="xprev__no">{n}</span>
              <code className="hl" dangerouslySetInnerHTML={{ __html: highlightFragment(text, lang) || ' ' }} />
            </span>
          );
        })}
      </pre>
    </div>
  );
}

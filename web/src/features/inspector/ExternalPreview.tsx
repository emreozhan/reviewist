import { useFileContent } from '../../hooks/queries';
import { highlightFragment, langFor } from '../../lib/highlight';
import { findDeclarationLine } from '../../lib/locate';
import { useReviewCtx } from '../workspace/ReviewContext';

interface ExternalPreviewProps {
  file: string;
  /** Sunucunun verdiği bildirim satırı (ImpactNode.range / CallRef.line). */
  line?: number;
  /** Satır bilinmiyorsa içerikte bildirimi aranacak sembol (yalnız yedek). */
  symbolId?: string;
  side?: 'old' | 'new';
  /** Dosya yolu tahmin: içerik yoksa bunu söyle. */
  guessed?: boolean;
  context?: number;
}

/** Diff dışındaki dosyadan ilgili satırın ±3 önizlemesi (sunucunun /file ucuyla; repo dosyaları da gelir). */
export function ExternalPreview({ file, line, symbolId, side = 'new', guessed, context = 3 }: ExternalPreviewProps) {
  const { review } = useReviewCtx();
  const q = useFileContent(review.id, file, side);
  const lang = langFor(file.endsWith('.java') ? 'java' : 'other');

  if (q.isPending) return <p className="xprev__state">Önizleme yükleniyor…</p>;
  if (q.isError) return <p className="xprev__state">Önizleme alınamadı: {q.error.message}</p>;
  if (!q.lines) {
    return (
      <p className="xprev__state">
        {guessed ? `Tahmin edilen dosya (${file}) depoda bulunamadı; sembolün konumu bilinmiyor.` : 'Dosya içeriği sunucudan alınamadı (kaynak içerik vermiyor olabilir).'}
      </p>
    );
  }

  const searched = !line && symbolId ? findDeclarationLine(q.lines, symbolId) : undefined;
  const target = line ?? searched;
  if (!target) return <p className="xprev__state">İlgili satır bulunamadı.</p>;

  const start = Math.max(1, target - context);
  const end = Math.min(q.lines.length, target + context);
  const slice = q.lines.slice(start - 1, end);

  return (
    <div className="xprev" role="region" aria-label={`${file} satır ${target} önizlemesi (diff dışı, değişmedi)`}>
      {searched && <p className="xprev__hint">Konum içerikte aranarak bulundu (yaklaşık).</p>}
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

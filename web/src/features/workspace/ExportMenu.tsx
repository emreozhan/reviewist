import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { buildMarkdown } from '../../lib/markdownExport';
import { useProgress } from '../../state/progressStore';
import { useReviewCtx } from './ReviewContext';

/** Notları Markdown olarak panoya kopyala ya da .md dosyası olarak indir. */
export function ExportMenu() {
  const { review, index } = useReviewCtx();
  const seen = useProgress((s) => s.seen);
  const notes = useProgress((s) => s.notes);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const noteCount = Object.values(notes).filter((n) => n.trim() !== '').length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markdown = () => buildMarkdown(review, index, { seen, notes });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setStatus('Panoya kopyalandı');
    } catch (error) {
      console.warn('Panoya yazılamadı', error);
      setStatus('Panoya erişilemedi; indirmeyi deneyin');
    }
  };

  const download = () => {
    const blob = new Blob([markdown()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inceleme-${(review.source.headSha ?? review.id).slice(0, 12)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('İndirildi');
  };

  return (
    <div className="menu" ref={rootRef}>
      <button type="button" className="btn btn--sm" title="Notları dışa aktar" aria-label="Notları dışa aktar" aria-haspopup="true" aria-expanded={open} onClick={() => { setOpen((o) => !o); setStatus(null); }}>
        <Icon name="note" /> <span className="btn__label">Notları dışa aktar</span>
        {noteCount > 0 && <span className="btn__count">{noteCount}</span>}
      </button>
      {open && (
        <div className="menu__pop" role="group" aria-label="Dışa aktarma seçenekleri">
          <p className="menu__info">
            {noteCount} not, görüldü durumu ve önemli bulgular Markdown olarak dışa aktarılır.
          </p>
          <button type="button" className="menu__item" onClick={() => void copy()}>
            <Icon name="copy" /> Markdown'u kopyala
          </button>
          <button type="button" className="menu__item" onClick={download}>
            <Icon name="download" /> .md dosyası indir
          </button>
          {status && (
            <p className="menu__status" role="status">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

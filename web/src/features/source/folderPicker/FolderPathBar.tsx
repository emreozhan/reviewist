import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { pathCrumbs } from '../../../lib/fsPath';

interface FolderPathBarProps {
  id: string;
  /** Gösterilen klasörün yolu (sunucunun normalize ettiği). */
  path: string;
  onGo: (path: string) => void;
  onUp?: () => void;
  loading: boolean;
}

/** Tıklanabilir yol kırıntısı + yazılabilir/yapıştırılabilir yol kutusu (Enter ile gider). */
export function FolderPathBar({ id, path, onGo, onUp, loading }: FolderPathBarProps) {
  const [draft, setDraft] = useState(path);
  useEffect(() => setDraft(path), [path]);
  const crumbs = pathCrumbs(path);

  return (
    <div className="fp-bar">
      <div className="fp-crumbs-row">
        <button type="button" className="icon-btn icon-btn--sm" onClick={onUp} disabled={!onUp} aria-label="Üst klasöre çık" title="Üst klasör (Backspace)">
          <Icon name="arrowUp" />
        </button>
        <ol className="fp-crumbs" aria-label="Yol">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={c.path} className="fp-crumbs__item">
                {last ? (
                  <span className="fp-crumbs__current" aria-current="location">
                    {c.label}
                  </span>
                ) : (
                  <button type="button" className="fp-crumbs__btn" onClick={() => onGo(c.path)} title={c.path}>
                    {c.label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        {loading && <span className="fp-spinner" role="status" aria-label="Yükleniyor" />}
      </div>
      <form
        className="fp-go"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (draft.trim()) onGo(draft);
        }}
      >
        <label htmlFor={`${id}-path`} className="sr-only">
          Klasör yolu
        </label>
        <input
          id={`${id}-path`}
          className="input input--mono fp-go__input"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder="C:\projeler\shop ya da /home/ayse/shop"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn--sm" disabled={!draft.trim()}>
          Git
        </button>
      </form>
    </div>
  );
}

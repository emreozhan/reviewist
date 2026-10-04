import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { GitRefs } from '../../../../src/shared/types';
import { Icon } from '../../components/Icon';
import { buildRefRows } from './refOptions';

interface RefSelectPopoverProps {
  value: string;
  refs?: GitRefs;
  loading?: boolean;
  emptyOption?: string;
  onPick: (value: string) => void;
  /** refocus: odak tetikleyici düğmeye dönsün mü (dışarı tıklamada dönmez). */
  onClose: (refocus: boolean) => void;
}

/** Arama kutusu + gruplu ref listesi; klavye: ↑/↓, Enter seçer, Esc kapatır. */
export function RefSelectPopover({ value, refs, loading, emptyOption, onPick, onClose }: RefSelectPopoverProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => buildRefRows(refs, query, emptyOption), [refs, query, emptyOption]);
  const currentIndex = rows.findIndex((r) => !r.special && r.value === value);
  const [active, setActive] = useState(() => Math.max(0, currentIndex));

  // Dışarı tıklama kapatır (odak tıklanan yere gider).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Etkin satır görünür alanda kalsın.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(rows.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home' && !query) setActive(0);
    else if (e.key === 'End' && !query) setActive(rows.length - 1);
    else if (e.key === 'Enter') {
      const row = rows[active];
      if (row) onPick(row.value);
    } else if (e.key === 'Escape') onClose(true);
    else if (e.key === 'Tab') {
      onClose(false);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let lastGroup = '';
  return (
    <div ref={rootRef} className="refsel__pop" role="dialog" aria-label="Ref seç">
      <div className="refsel__search">
        <Icon name="search" className="refsel__search-icon" />
        <input
          autoFocus
          className="refsel__search-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
          placeholder="Dal, etiket ya da commit ara…"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {rows.length === 0 ? (
        <p className="refsel__empty">{loading ? 'Dallar yükleniyor…' : refs ? 'Bu repoda ref bulunamadı.' : 'Dallar okunamadı; ref adını yazabilirsiniz.'}</p>
      ) : (
        <ul ref={listRef} id={listId} className="refsel__list" role="listbox" aria-label="Ref'ler">
          {rows.map((r, i) => {
            const header = !r.special && r.group !== lastGroup ? r.group : null;
            if (!r.special) lastGroup = r.group;
            const current = !r.special && r.value === value;
            return (
              <li
                key={r.key}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={current}
                data-group={header ?? undefined}
                className={`refsel__opt${i === active ? ' is-active' : ''}${current ? ' is-current' : ''}${r.special ? ` is-${r.special}` : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(r.value);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="refsel__check">{current && <Icon name="check" />}</span>
                <span className="refsel__opt-label">{r.special === 'custom' ? `“${r.label}”` : r.label}</span>
                {r.meta && <span className="refsel__opt-meta">{r.meta}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

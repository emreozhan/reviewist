import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { GitRefs } from '../../../../src/shared/types';
import { buildRefOptions, filterRefOptions } from './refOptions';

interface RefComboboxProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  refs?: GitRefs;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}

/** Aranabilir ref seçici (ARIA combobox): dal, uzak dal, etiket veya son commit; serbest metin de kabul eder. */
export function RefCombobox({ id, value, onChange, refs, placeholder, invalid, describedBy }: RefComboboxProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // null = kullanıcı açtıktan sonra henüz yazmadı: tüm refler gösterilir (mevcut değerle süzülmez).
  const [query, setQuery] = useState<string | null>(null);
  const all = buildRefOptions(refs);
  const options = filterRefOptions(all, query ?? '');

  const openList = () => {
    setQuery(null);
    setActive(Math.max(0, all.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && open) {
      const opt = options[active];
      if (opt) {
        e.preventDefault();
        choose(opt.value);
      }
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const showEmpty = open && refs !== undefined && options.length === 0;
  let lastGroup = '';
  return (
    <div className="combo">
      <input
        ref={inputRef}
        id={id}
        className="input input--mono combo__input"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={openList}
        onClick={() => {
          if (!open) openList();
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="combo__toggle"
        tabIndex={-1}
        aria-label="Ref listesini aç"
        disabled={!refs}
        onMouseDown={(e) => {
          e.preventDefault();
          if (open) setOpen(false);
          else {
            inputRef.current?.focus();
            openList();
          }
        }}
      >
        ▾
      </button>
      {open && options.length > 0 && (
        <ul id={listId} className="combo__list" role="listbox" aria-label="Ref önerileri">
          {options.map((o, i) => {
            const header = o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li
                key={`${o.group}:${o.value}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`combo__opt${i === active ? ' is-active' : ''}${o.value === value ? ' is-current' : ''}`}
                data-group={header ?? undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.value);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="combo__label">{o.label}</span>
                {o.meta && <span className="combo__meta">{o.meta}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {showEmpty && (
        <div className="combo__list combo__empty" role="status">
          Eşleşen ref yok; yazdığınız değer olduğu gibi kullanılır.
        </div>
      )}
    </div>
  );
}

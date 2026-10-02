import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon';
import type { NavFilters as Filters } from '../../lib/selectors';
import type { NavMode } from '../../state/uiStore';
import { useUi } from '../../state/uiStore';

type ToggleKey = keyof Omit<Filters, 'query'>;

function toggles(mode: NavMode): { key: ToggleKey; label: string; title: string }[] {
  const plan = mode === 'plan';
  return [
    { key: 'onlyHighRisk', label: plan ? 'Yalnız riskli adımlar' : 'Yalnız yüksek risk', title: 'Yalnız kendisi ya da içindeki bir tip/üye yüksek veya kritik riskli dosyalar' },
    { key: 'hideTests', label: 'Testleri gizle', title: 'Test dosyalarını listeden çıkar' },
    { key: 'hideCosmetic', label: 'Kozmetikler sonda', title: 'Yalnız biçim/import değişen dosyaları en sona katla' },
  ];
}

export function NavFilters({ mode }: { mode: NavMode }) {
  const filters = useUi((s) => s.filters);
  const setFilters = useUi((s) => s.setFilters);
  const tick = useUi((s) => s.searchFocusTick);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tick > 0) inputRef.current?.focus();
  }, [tick]);

  return (
    <div className="nav__filters">
      <div className="search">
        <Icon name="search" className="search__icon" />
        <input
          ref={inputRef}
          type="search"
          className="search__input"
          placeholder="Dosya veya sembol ara"
          aria-label="Dosya veya sembol ara (kısayol: /)"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFilters({ query: '' });
              e.currentTarget.blur();
            }
          }}
        />
        <kbd className="search__kbd" aria-hidden="true">/</kbd>
      </div>
      <div className="filter-chips" role="group" aria-label="Filtreler">
        {toggles(mode).map((t) => (
          <button
            key={t.key}
            type="button"
            className={`filter-chip${filters[t.key] ? ' is-on' : ''}`}
            aria-pressed={filters[t.key]}
            title={t.title}
            onClick={() => setFilters({ [t.key]: !filters[t.key] })}
          >
            <span className="filter-chip__box" aria-hidden="true">{filters[t.key] ? '■' : '□'}</span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

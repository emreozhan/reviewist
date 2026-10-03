import type { ImpactNodeStatus, SymbolKind } from '../../../../src/shared/types';
import { StatusGlyph } from '../../components/StatusGlyph';
import { KIND_LABEL } from '../../lib/labels';

export interface OutlineItem {
  id: string;
  label: string;
  kind: SymbolKind;
  line: number;
  endLine: number;
  depth: number;
  status?: ImpactNodeStatus;
}

const KIND_MARK: Partial<Record<SymbolKind, string>> = {
  class: 'C',
  interface: 'I',
  enum: 'E',
  record: 'R',
  annotation: '@',
  method: 'm',
  constructor: 'c',
  field: 'f',
  enumConstant: 'k',
};

interface SourceOutlineProps {
  items: OutlineItem[];
  activeId?: string;
  onPick: (item: OutlineItem) => void;
  /** Ana hat sunucudan değil graf düğümlerinden (yaklaşık) üretildi. */
  approximate: boolean;
  loading?: boolean;
}

/** Dosyanın sembol ana hattı (sol kenar): tıklayınca o bildirime gidilir. */
export function SourceOutline({ items, activeId, onPick, approximate, loading = false }: SourceOutlineProps) {
  return (
    <nav className="sv-outline" aria-label="Sembol ana hattı">
      <p className="sv-outline__title">
        Ana hat
        {loading && <span className="sv-outline__approx" role="status"> · yükleniyor…</span>}
        {approximate && !loading && <span className="sv-outline__approx" title="Sunucu ana hat vermedi; etki haritasındaki semboller gösteriliyor."> · yaklaşık</span>}
      </p>
      {items.length === 0 ? (
        <p className="sv-outline__empty">Sembol yok.</p>
      ) : (
        <ul className="sv-outline__list">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className={`sv-outline__item${it.id === activeId ? ' is-active' : ''}`}
                style={{ paddingLeft: 8 + it.depth * 12 }}
                onClick={() => onPick(it)}
                aria-current={it.id === activeId ? 'true' : undefined}
                title={`${KIND_LABEL[it.kind]} ${it.label} — satır ${it.line}`}
              >
                <span className={`sv-outline__kind sv-outline__kind--${it.kind}`} aria-hidden="true">
                  {KIND_MARK[it.kind] ?? '·'}
                </span>
                <span className="sv-outline__label">{it.label}</span>
                {it.status && <StatusGlyph status={it.status} size="sm" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

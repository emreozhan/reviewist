import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { GitSourceForm } from './GitSourceForm';
import { PatchForm } from './PatchForm';
import type { SourceFormProps } from './sourceFormProps';
import { WorktreeForm } from './WorktreeForm';

/** Yalnız yerel sürüm: yerel depo kaynakları. (GitHub sürümünde bu modül pakete girmez.) */
type SourceTab = 'git' | 'worktree' | 'patch';

const TABS: { id: SourceTab; label: string; sub: string }[] = [
  { id: 'git', label: 'Yerel Git', sub: 'iki ref' },
  { id: 'worktree', label: 'Çalışma Ağacı', sub: 'commit edilmemiş' },
  { id: 'patch', label: 'Patch yapıştır', sub: 'unified diff' },
];

/** Kaynak seçimi sekmeleri (ARIA tablist; ok tuşlarıyla gezilir). */
export function SourceTabs({ config, pending, onSubmit, serverError, onEdit }: SourceFormProps) {
  const [tab, setTab] = useState<SourceTab>('git');

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const idx = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    setTab(next.id);
    document.getElementById(`src-tab-${next.id}`)?.focus();
  };

  const props = { config, pending, onSubmit, serverError, onEdit };
  return (
    <div className="source-card">
      <div className="source-tabs" role="tablist" aria-label="Kaynak türü" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`src-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`src-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`source-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="source-tab__label">{t.label}</span>
            <span className="source-tab__sub">{t.sub}</span>
          </button>
        ))}
      </div>
      <div id={`src-panel-${tab}`} role="tabpanel" aria-labelledby={`src-tab-${tab}`} className="source-panel">
        {tab === 'git' && <GitSourceForm {...props} />}
        {tab === 'worktree' && <WorktreeForm {...props} />}
        {tab === 'patch' && <PatchForm {...props} />}
      </div>
    </div>
  );
}

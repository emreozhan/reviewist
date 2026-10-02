import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AppConfig, ReviewRequest } from '../../../../src/shared/types';
import { GithubForm } from './GithubForm';
import { GitSourceForm } from './GitSourceForm';
import { PatchForm } from './PatchForm';
import { WorktreeForm } from './WorktreeForm';
import type { ServerFieldError } from './serverFieldError';

type SourceTab = 'git' | 'worktree' | 'github' | 'patch';

const TABS: { id: SourceTab; label: string; sub: string }[] = [
  { id: 'git', label: 'Yerel Git', sub: 'iki ref' },
  { id: 'worktree', label: 'Çalışma Ağacı', sub: 'commit edilmemiş' },
  { id: 'github', label: 'GitHub PR', sub: 'URL' },
  { id: 'patch', label: 'Patch yapıştır', sub: 'unified diff' },
];

interface SourceTabsProps {
  config?: AppConfig;
  pending: boolean;
  onSubmit: (req: ReviewRequest) => void;
  serverError?: ServerFieldError;
  /** Formda bir alan değişince (sunucu hatasını temizlemek için). */
  onEdit?: () => void;
}

/** Kaynak seçimi sekmeleri (ARIA tablist; ok tuşlarıyla gezilir). */
export function SourceTabs({ config, pending, onSubmit, serverError, onEdit }: SourceTabsProps) {
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
        {tab === 'github' && <GithubForm {...props} />}
        {tab === 'patch' && <PatchForm {...props} />}
      </div>
    </div>
  );
}

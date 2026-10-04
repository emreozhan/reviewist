import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Field } from '../../components/Field';
import { Switch } from '../../components/Switch';
import { useRefs } from '../../hooks/queries';
import type { SourceFormProps } from './GitSourceForm';
import { RefCombobox } from './RefCombobox';
import { isKnownRef } from './refOptions';
import { RepoPathField } from './RepoPathField';
import { serverErrorFor } from './serverFieldError';

export function WorktreeForm({ config, pending, onSubmit, serverError, onEdit }: SourceFormProps) {
  const [repoPath, setRepoPath] = useState(config?.defaultRepoPath ?? '');
  const [committed, setCommitted] = useState(config?.defaultRepoPath ?? '');
  const [base, setBase] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [localError, setError] = useState<string | undefined>();
  const error = localError ?? serverErrorFor(serverError, 'worktree', 'repoPath');
  const baseError = serverErrorFor(serverError, 'worktree', 'base');
  const refs = useRefs(committed);

  // Repo değişince yeni repoda olmayan taban temizlenir (boş = HEAD).
  useEffect(() => {
    const data = refs.data;
    if (!data) return;
    setBase((b) => (b && !isKnownRef(data, b) ? '' : b));
  }, [refs.data]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!repoPath.trim()) {
      setError('zorunlu; deponun kök dizinini girin.');
      return;
    }
    setError(undefined);
    onSubmit({ kind: 'worktree', repoPath: repoPath.trim(), base: base.trim() || undefined, includeUntracked });
  };

  return (
    <form className="source-form" onSubmit={submit} onChange={onEdit} noValidate>
      <p className="source-form__lead">Commit edilmemiş değişiklikleri (staged + unstaged) inceleyin; AI ajanının bıraktığı çalışma ağacı için idealdir.</p>
      <RepoPathField id="wt-repo" value={repoPath} onChange={setRepoPath} onCommit={() => setCommitted(repoPath.trim())} refsQuery={committed ? refs : undefined} error={error} />
      <Field id="wt-base" label="Karşılaştırma tabanı" optional error={baseError} hint="Boş bırakılırsa HEAD ile karşılaştırılır.">
        <RefCombobox id="wt-base" value={base} onChange={setBase} refs={refs.data} placeholder="HEAD" invalid={!!baseError} describedBy={baseError ? 'wt-base-error' : 'wt-base-hint'} />
      </Field>
      <Switch checked={includeUntracked} onChange={setIncludeUntracked} label="Takip edilmeyen (untracked) dosyaları dahil et" hint="Yeni oluşturulmuş ama git'e eklenmemiş dosyalar da analize girer." />
      <div className="source-form__actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={pending}>
          Çalışma ağacını analiz et
        </button>
      </div>
    </form>
  );
}

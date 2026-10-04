import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppConfig, ReviewRequest } from '../../../../src/shared/types';
import { Field } from '../../components/Field';
import { Switch } from '../../components/Switch';
import { useRefs } from '../../hooks/queries';
import { RefCombobox } from './RefCombobox';
import { isKnownRef, suggestHead } from './refOptions';
import { RepoPathField } from './RepoPathField';
import type { ServerFieldError } from './serverFieldError';
import { serverErrorFor } from './serverFieldError';

export interface SourceFormProps {
  config?: AppConfig;
  pending: boolean;
  onSubmit: (req: ReviewRequest) => void;
  /** Sunucunun alan hatası (ApiError.field). */
  serverError?: ServerFieldError;
  onEdit?: () => void;
}

export function GitSourceForm({ config, pending, onSubmit, serverError, onEdit }: SourceFormProps) {
  const [repoPath, setRepoPath] = useState(config?.defaultRepoPath ?? '');
  const [committed, setCommitted] = useState(config?.defaultRepoPath ?? '');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [mergeBase, setMergeBase] = useState(true);
  const [localErrors, setErrors] = useState<Record<string, string>>({});
  const errors: Record<string, string | undefined> = {
    repoPath: localErrors.repoPath ?? serverErrorFor(serverError, 'git', 'repoPath'),
    base: localErrors.base ?? serverErrorFor(serverError, 'git', 'base'),
    head: localErrors.head ?? serverErrorFor(serverError, 'git', 'head'),
  };
  const refs = useRefs(committed);

  // Repo değişince önceki repodan kalan ve yenisinde olmayan ref'ler o reponun varsayılanlarına döner;
  // head tabanla aynı kalacaksa tabandan farklı en güncel dal önerilir.
  const latest = useRef({ base, head });
  useEffect(() => {
    latest.current = { base, head };
  });
  useEffect(() => {
    const data = refs.data;
    if (!data) return;
    const { base: b, head: h } = latest.current;
    const nextBase = isKnownRef(data, b) ? b : data.defaultBase || '';
    setBase(nextBase);
    setHead(isKnownRef(data, h) && h !== nextBase ? h : suggestHead(data, nextBase));
  }, [refs.data]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!repoPath.trim()) next.repoPath = 'zorunlu; deponun kök dizinini girin.';
    if (!base.trim()) next.base = 'zorunlu; karşılaştırmanın tabanı (ör. main).';
    if (!head.trim()) next.head = 'zorunlu; incelenecek dal veya commit.';
    if (base.trim() && base.trim() === head.trim()) next.head = 'taban ile aynı olamaz.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit({ kind: 'git', repoPath: repoPath.trim(), base: base.trim(), head: head.trim(), mode: mergeBase ? 'mergeBase' : 'range' });
  };

  return (
    <form className="source-form" onSubmit={submit} onChange={onEdit} noValidate>
      <RepoPathField id="git-repo" value={repoPath} onChange={setRepoPath} onCommit={(v) => setCommitted(v.trim())} onPicked={() => { setErrors(({ repoPath: _picked, ...rest }) => rest); onEdit?.(); }} refsQuery={committed ? refs : undefined} error={errors.repoPath} />
      <div className="source-form__row">
        <Field id="git-base" label="Taban (base)" error={errors.base} hint="Dal, etiket ya da commit">
          <RefCombobox id="git-base" value={base} onChange={setBase} refs={refs.data} placeholder="main" invalid={!!errors.base} describedBy={errors.base ? 'git-base-error' : 'git-base-hint'} />
        </Field>
        <span className="source-form__arrow" aria-hidden="true">→</span>
        <Field id="git-head" label="İncelenecek (head)" error={errors.head} hint="Değişiklikleri içeren ref">
          <RefCombobox id="git-head" value={head} onChange={setHead} refs={refs.data} placeholder="feature/…" invalid={!!errors.head} describedBy={errors.head ? 'git-head-error' : 'git-head-hint'} />
        </Field>
      </div>
      <Switch
        checked={mergeBase}
        onChange={setMergeBase}
        label="PR semantiği (merge-base)"
        hint={mergeBase ? 'Yalnız head dalında yapılan değişiklikler gösterilir (base...head), GitHub PR gibi.' : 'İki ref arasındaki doğrudan fark gösterilir (base..head); tabandaki yeni commit\'ler de farka girer.'}
      />
      <div className="source-form__actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={pending}>
          Analiz et
        </button>
      </div>
    </form>
  );
}

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Field } from '../../../components/Field';
import { loadRecentUrls } from '../../../lib/recentUrls';
import { serverErrorFor } from '../serverFieldError';
import type { SourceFormProps } from '../sourceFormProps';
import type { GithubField, GithubFormErrors } from './githubTarget';
import { looksLikePrUrl, URL_EXAMPLE, validateGithubForm } from './githubTarget';
import { RecentUrls } from './RecentUrls';

/** Yalnız GitHub sürümü: PR ya da depo adresi + isteğe bağlı taban/head. Token ve yerel klon yolu sunucu tarafındadır. */
export function GithubForm({ pending, onSubmit, serverError, onEdit }: SourceFormProps) {
  const [url, setUrl] = useState('');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [recent] = useState(() => loadRecentUrls());
  const [localErrors, setErrors] = useState<GithubFormErrors>({});
  const errorOf = (f: GithubField) => localErrors[f] ?? serverErrorFor(serverError, 'github', f);
  const errors = { url: errorOf('url'), base: errorOf('base'), head: errorOf('head') };

  const trimmed = url.trim();
  const isPr = looksLikePrUrl(trimmed);
  const headRequired = trimmed !== '' && !isPr;
  const headHint = trimmed === '' ? 'PR adresinde isteğe bağlı; depo adresinde zorunlu.' : isPr ? "Boşsa PR'ın kendi dalı incelenir." : 'Depo adresinde zorunlu: değişiklikleri içeren dal, etiket ya da commit.';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateGithubForm({ url, base, head });
    setErrors(result.errors);
    if (result.request) onSubmit(result.request);
  };

  const pick = (u: string) => {
    setUrl(u);
    setErrors({});
    onEdit?.();
  };

  return (
    <form className="source-form" onSubmit={submit} onChange={onEdit} noValidate>
      <Field
        id="gh-url"
        label="PR ya da depo adresi"
        error={errors.url}
        hint={<>PR: <code>…/sahip/depo/pull/123</code>, <code>sahip/depo#123</code> · Depo: <code>https://github.com/sahip/depo</code>, <code>git@github.com:sahip/depo.git</code></>}
      >
        <input id="gh-url" className="input input--mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={URL_EXAMPLE} spellCheck={false} autoComplete="off" aria-invalid={!!errors.url || undefined} aria-describedby={errors.url ? 'gh-url-error' : 'gh-url-hint'} />
      </Field>
      <RecentUrls urls={recent} onPick={pick} />
      <div className="source-form__row">
        <Field id="gh-base" label="Taban dal" optional error={errors.base} hint="Boşsa PR'ın hedef dalı ya da deponun varsayılan dalı">
          <input id="gh-base" className="input input--mono" value={base} onChange={(e) => setBase(e.target.value)} placeholder="ör. main" spellCheck={false} autoComplete="off" aria-invalid={!!errors.base || undefined} aria-describedby={errors.base ? 'gh-base-error' : 'gh-base-hint'} />
        </Field>
        <span className="source-form__arrow" aria-hidden="true">→</span>
        <Field id="gh-head" label="İncelenecek dal / etiket / commit" optional={!headRequired} required={headRequired} error={errors.head} hint={headHint}>
          <input id="gh-head" className="input input--mono" value={head} onChange={(e) => setHead(e.target.value)} placeholder={isPr ? "PR'ın dalı" : 'ör. feature/odeme'} spellCheck={false} autoComplete="off" aria-required={headRequired || undefined} aria-invalid={!!errors.head || undefined} aria-describedby={errors.head ? 'gh-head-error' : 'gh-head-hint'} />
        </Field>
      </div>
      <div className="source-form__actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={pending}>
          {isPr ? "PR'ı klonla ve analiz et" : 'Klonla ve analiz et'}
        </button>
      </div>
    </form>
  );
}

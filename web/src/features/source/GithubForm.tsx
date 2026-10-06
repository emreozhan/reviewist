import { useState } from 'react';
import type { FormEvent } from 'react';
import { Field } from '../../components/Field';
import { FolderPathInput } from './folderPicker/FolderPathInput';
import type { SourceFormProps } from './GitSourceForm';
import { serverErrorFor } from './serverFieldError';
import { SAMPLE_REPO_PATH } from '../../lib/platform';

const PR_URL = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+/;

export function GithubForm({ config, pending, onSubmit, serverError, onEdit }: SourceFormProps) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [localRepoPath, setLocalRepoPath] = useState('');
  const [localError, setError] = useState<string | undefined>();
  const error = localError ?? serverErrorFor(serverError, 'github', 'url');
  const tokenError = serverErrorFor(serverError, 'github', 'token');
  const localPathError = serverErrorFor(serverError, 'github', 'localRepoPath');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return setError('zorunlu; ör. https://github.com/acme/shop/pull/482');
    if (!PR_URL.test(u)) return setError('PR adresi biçimi tanınmadı; …/owner/repo/pull/<numara> olmalı.');
    setError(undefined);
    onSubmit({ kind: 'github', url: u, token: token.trim() || undefined, localRepoPath: localRepoPath.trim() || undefined });
  };

  return (
    <form className="source-form" onSubmit={submit} onChange={onEdit} noValidate>
      <Field id="gh-url" label="PR adresi" error={error} hint="GitHub veya GitHub Enterprise pull request bağlantısı.">
        <input id="gh-url" className="input input--mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/acme/shop/pull/482" spellCheck={false} aria-invalid={!!error || undefined} aria-describedby={error ? 'gh-url-error' : 'gh-url-hint'} />
      </Field>
      <Field
        id="gh-token"
        label="Erişim token'ı"
        optional
        error={tokenError}
        hint={
          <>
            Token yalnızca bu analiz isteğinin gövdesinde sunucuya gönderilir; tarayıcıda ya da diskte <strong>saklanmaz</strong>.
            {config?.githubTokenConfigured && ' Sunucuda yapılandırılmış bir token var; boş bırakabilirsiniz.'}
          </>
        }
      >
        <input id="gh-token" className="input input--mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" aria-invalid={!!tokenError || undefined} aria-describedby={tokenError ? 'gh-token-error' : 'gh-token-hint'} />
      </Field>
      <Field
        id="gh-local"
        label="Yerel klon yolu"
        optional
        error={localPathError}
        hint="Verirseniz diff dışındaki çağıranlar ve alt sınıflar bu klondan indekslenir (yayılım analizi tam olur). Vermezseniz analiz yalnızca PR'daki dosyalarla sınırlı kalır."
      >
        <FolderPathInput id="gh-local" value={localRepoPath} onChange={setLocalRepoPath} onPicked={onEdit} placeholder={config?.defaultRepoPath ?? SAMPLE_REPO_PATH} invalid={!!localPathError} describedBy={localPathError ? 'gh-local-error' : 'gh-local-hint'} />
      </Field>
      <div className="source-form__actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={pending}>
          PR'ı analiz et
        </button>
      </div>
    </form>
  );
}

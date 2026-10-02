import { useState } from 'react';
import type { FormEvent } from 'react';
import { Field } from '../../components/Field';
import type { SourceFormProps } from './GitSourceForm';
import { serverErrorFor } from './serverFieldError';

export function PatchForm({ config, pending, onSubmit, serverError, onEdit }: SourceFormProps) {
  const [text, setText] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [localError, setError] = useState<string | undefined>();
  const error = localError ?? serverErrorFor(serverError, 'patch', 'text');
  const repoError = serverErrorFor(serverError, 'patch', 'repoPath');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return setError('boş; `git diff` veya `.patch` çıktısını yapıştırın.');
    if (!/^(diff --git|---\s|\+\+\+\s|@@\s)/m.test(text)) return setError('birleşik diff (unified) biçimi tanınmadı; "diff --git" veya "@@" satırları bekleniyor.');
    setError(undefined);
    onSubmit({ kind: 'patch', text, repoPath: repoPath.trim() || undefined });
  };

  return (
    <form className="source-form" onSubmit={submit} onChange={onEdit} noValidate>
      <Field id="patch-text" label="Patch" error={error} hint="git diff, git format-patch ya da PR'dan indirilen .diff içeriği.">
        <textarea id="patch-text" className="input input--mono textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={'diff --git a/src/main/java/… b/src/main/java/…\n@@ -12,7 +12,9 @@ …'} aria-invalid={!!error || undefined} aria-describedby={error ? 'patch-text-error' : 'patch-text-hint'} />
      </Field>
      <Field id="patch-repo" label="Repo yolu" optional error={repoError} hint="Verilirse dosya içerikleri ve diff dışındaki çağıranlar bu depodan okunur; verilmezse yalnız hunk'lar analiz edilir.">
        <input id="patch-repo" className="input input--mono" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder={config?.defaultRepoPath ?? 'C:/projeler/shop'} spellCheck={false} aria-invalid={!!repoError || undefined} aria-describedby={repoError ? 'patch-repo-error' : 'patch-repo-hint'} />
      </Field>
      <div className="source-form__actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={pending}>
          Patch'i analiz et
        </button>
      </div>
    </form>
  );
}

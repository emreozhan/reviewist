import type { UseQueryResult } from '@tanstack/react-query';
import type { GitRefs } from '../../../../src/shared/types';
import { Field } from '../../components/Field';

interface RepoPathFieldProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** Alan bırakılınca (blur/Enter) ref'leri yüklemek için. */
  onCommit: () => void;
  refsQuery?: UseQueryResult<GitRefs>;
  error?: string;
  optional?: boolean;
  hint?: string;
}

function refsStatus(q: UseQueryResult<GitRefs> | undefined): string | undefined {
  if (!q) return undefined;
  if (q.isFetching) return 'Ref\'ler okunuyor…';
  if (q.isError) return `Ref'ler okunamadı: ${q.error.message}`;
  if (q.data) {
    const d = q.data;
    return `${d.branches.length} dal, ${d.tags.length} etiket, ${d.recentCommits.length} son commit${d.currentBranch ? ` · geçerli dal: ${d.currentBranch}` : ''}`;
  }
  return undefined;
}

export function RepoPathField({ id, value, onChange, onCommit, refsQuery, error, optional, hint }: RepoPathFieldProps) {
  const status = refsStatus(refsQuery);
  return (
    <Field id={id} label="Repo yolu" error={error} optional={optional} hint={status ?? hint ?? 'Yerel git deposunun kök dizini.'}>
      <input
        id={id}
        className="input input--mono"
        value={value}
        spellCheck={false}
        placeholder="C:/projeler/shop"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit();
          }
        }}
      />
    </Field>
  );
}

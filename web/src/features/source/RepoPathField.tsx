import type { UseQueryResult } from '@tanstack/react-query';
import type { GitRefs } from '../../../../src/shared/types';
import { Field } from '../../components/Field';
import { FolderPathInput } from './folderPicker/FolderPathInput';
import { SAMPLE_REPO_PATH } from '../../lib/platform';

interface RepoPathFieldProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** Alan bırakılınca (blur/Enter) ya da klasör seçicide seçilince ref'leri yüklemek için (güncel değerle). */
  onCommit: (value: string) => void;
  /** Klasör seçicide seçim yapıldı. */
  onPicked?: () => void;
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

export function RepoPathField({ id, value, onChange, onCommit, onPicked, refsQuery, error, optional, hint }: RepoPathFieldProps) {
  const status = refsStatus(refsQuery);
  return (
    <Field id={id} label="Depo yolu" error={error} optional={optional} hint={status ?? hint ?? 'Yerel git deposunun kök dizini.'}>
      <FolderPathInput
        id={id}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        onPicked={onPicked}
        placeholder={SAMPLE_REPO_PATH}
        invalid={!!error}
        describedBy={error ? `${id}-error` : `${id}-hint`}
      />
    </Field>
  );
}

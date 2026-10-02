import type { FileStatus } from '../../../src/shared/types';
import { FILE_STATUS_META } from '../lib/labels';

export function FileStatusIcon({ status }: { status: FileStatus }) {
  const meta = FILE_STATUS_META[status];
  return (
    <span className={`fstatus status--${meta.status}`} title={meta.label}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

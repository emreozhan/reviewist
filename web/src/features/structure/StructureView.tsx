import { useMemo } from 'react';
import type { FileChange, TypeChange } from '../../../../src/shared/types';
import { VirtualList } from '../../components/VirtualList';
import type { StructureRow } from '../../lib/structureRows';
import { structureKeyOf, structureRows } from '../../lib/structureRows';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { MemberRow } from './MemberRow';
import { TypeHead } from './TypeBlock';

const rowKey = (r: StructureRow) => r.key;

function estimate(r: StructureRow): number {
  if (r.kind === 'type') return (r.first ? 0 : 18) + 46 + (r.type.details.length > 0 ? 24 : 0);
  if (r.kind === 'more') return 32;
  return r.member.status === 'unchanged' ? 30 : 64 + (r.member.details.length > 0 ? 18 * Math.min(r.member.details.length, 4) : 0);
}

function rowClass(r: StructureRow): string {
  return `tbrow tbrow--${r.kind} st-line--${r.type.status}${r.first ? ' is-first' : ''}${r.last ? ' is-last' : ''}`;
}

/** Java dosyasının tip/üye iskeleti; yüzlerce üyede pencereli çizilir. */
export function StructureView({ file }: { file: FileChange }) {
  const { index } = useReviewCtx();
  const showUnchanged = useUi((s) => s.showUnchanged);
  const toggleUnchanged = useUi((s) => s.toggleShowUnchanged);
  const selected = useUi((s) => s.selectedSymbolId);
  const types = useMemo(() => file.typeIds.map((id) => index.typeById.get(id)).filter((t): t is TypeChange => !!t), [file, index]);
  const rows = useMemo(() => structureRows(types, showUnchanged), [types, showUnchanged]);
  const activeKey = structureKeyOf(selected, !!selected && index.memberById.has(selected));

  if (types.length === 0) {
    return <p className="center__note">Bu dosyada çözümlenmiş tip yok; Diff görünümünü kullanın.</p>;
  }
  return (
    <div className="structure">
      <VirtualList<StructureRow>
        ariaLabel="Tip ve üye iskeleti"
        items={rows}
        itemKey={rowKey}
        estimate={estimate}
        threshold={150}
        activeKey={activeKey}
        itemClassName={rowClass}
        renderItem={(r) => (
          <div className="tbcard">
            {r.kind === 'type' && <TypeHead type={r.type} file={file} />}
            {r.kind === 'member' && <MemberRow member={r.member} file={file} />}
            {r.kind === 'more' && (
              <button type="button" className="tblock__more" aria-pressed={showUnchanged} onClick={toggleUnchanged}>
                {showUnchanged ? 'Değişmeyen üyeleri gizle' : `Değişmeyen ${r.unchanged} üyeyi göster`}
              </button>
            )}
          </div>
        )}
      />
    </div>
  );
}

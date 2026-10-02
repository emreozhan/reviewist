import type { FileChange, TypeChange } from '../../../../src/shared/types';
import { useReviewCtx } from '../workspace/ReviewContext';
import { TypeBlock } from './TypeBlock';

/** Java dosyasının tip/üye iskeleti. */
export function StructureView({ file }: { file: FileChange }) {
  const { index } = useReviewCtx();
  const types = file.typeIds.map((id) => index.typeById.get(id)).filter((t): t is TypeChange => !!t);

  if (types.length === 0) {
    return <p className="center__note">Bu dosyada çözümlenmiş tip yok; Diff görünümünü kullanın.</p>;
  }
  return (
    <div className="structure">
      {types.map((t) => (
        <TypeBlock key={t.id} type={t} file={file} />
      ))}
    </div>
  );
}

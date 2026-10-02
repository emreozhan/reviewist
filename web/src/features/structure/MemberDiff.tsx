import type { FileChange, MemberChange } from '../../../../src/shared/types';
import { langFor } from '../../lib/highlight';
import { baseName } from '../../lib/reviewIndex';
import { UnifiedTable } from '../diff/UnifiedTable';
import { useMemberDiff } from './useMemberDiff';

interface MemberDiffProps {
  file: FileChange;
  member: MemberChange;
}

/** Seçili üyenin yalnız kendi satırlarını gösteren odaklı diff. */
export function MemberDiff({ file, member }: MemberDiffProps) {
  const d = useMemberDiff(file, member);
  const hasLines = d.rows.some((r) => r.kind === 'line');

  return (
    <div className="mdiff">
      {d.mode === 'moved' && d.counterpartFile && (
        <p className="mdiff__note">
          Eski konumla karşılaştırma: <code>{baseName(d.counterpartFile)}</code> (eski) → <code>{baseName(file.path)}</code> (yeni)
        </p>
      )}
      {d.partial && <p className="mdiff__note">Tam dosya içeriği alınamadı; yalnız diff hunk'larına düşen satırlar gösteriliyor.</p>}
      {!hasLines ? (
        <p className="mdiff__note">{d.loading ? 'Satırlar yükleniyor…' : 'Bu üyenin aralığında gösterilecek satır yok.'}</p>
      ) : (
        <div className="code-surface code-surface--inset">
          <UnifiedTable rows={d.rows} lang={langFor(file.language)} oldHl={d.oldHl} newHl={d.newHl} label={`${member.name} üye farkı`} />
        </div>
      )}
    </div>
  );
}

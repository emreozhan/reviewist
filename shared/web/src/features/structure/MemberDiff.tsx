import type { FileChange, MemberChange } from '../../../../src/shared/types';
import { langFor } from '../../lib/highlight';
import { baseName } from '../../lib/reviewIndex';
import { HeightResizer } from '../../components/HeightResizer';
import { useLayout } from '../../state/layoutStore';
import { useCodeRefs } from '../codenav/useCodeRefs';
import { useRef } from 'react';
import { UnifiedTable } from '../diff/UnifiedTable';
import { useMemberDiff } from './useMemberDiff';

interface MemberDiffProps {
  file: FileChange;
  member: MemberChange;
}

/** Seçili üyenin yalnız kendi satırlarını gösteren odaklı diff. */
export function MemberDiff({ file, member }: MemberDiffProps) {
  const d = useMemberDiff(file, member);
  // Taşınan üyede satırlar başka dosyayla karşılaştırılır; referanslar yalnız bu dosyanın yeni tarafında.
  const refs = useCodeRefs(member.newRange && file.status !== 'deleted' ? file.path : undefined, 'new', file.language === 'java');
  const height = useLayout((s) => s.heights.mdiff);
  const boxRef = useRef<HTMLDivElement>(null);
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
        <>
          <div
            ref={boxRef}
            className={`code-surface code-surface--inset${height !== undefined ? ' is-sized' : ''}${refs.spans ? ' has-refs' : ''}`}
            style={height !== undefined ? { height } : undefined}
            {...refs.handlers}
          >
            <UnifiedTable rows={d.rows} lang={langFor(file.language)} oldHl={d.oldHl} newHl={d.newHl} label={`${member.name} üye farkı`} refSpans={refs.spans} />
          </div>
          <HeightResizer id="mdiff" target={boxRef} label="Üye farkı yüksekliği" />
          {refs.menu}
        </>
      )}
    </div>
  );
}

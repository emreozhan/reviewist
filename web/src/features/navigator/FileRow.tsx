import { useEffect, useRef } from 'react';
import type { FileChange } from '../../../../src/shared/types';
import { DeltaBar } from '../../components/DeltaBar';
import { FileStatusIcon } from '../../components/FileStatusIcon';
import { RiskBadge } from '../../components/RiskBadge';
import { baseName, compactDir } from '../../lib/reviewIndex';
import { useProgress } from '../../state/progressStore';
import { useUi } from '../../state/uiStore';

interface FileRowProps {
  file: FileChange;
  /** Okuma planındaki sıra numarası. */
  order?: number;
  compact?: boolean;
}

/** Gezgin satırı: görüldü kutusu + dosyayı seçen düğme (durum, ad, +/−, risk, kozmetik). */
export function FileRow({ file, order, compact = false }: FileRowProps) {
  const selected = useUi((s) => s.selectedFileId === file.id);
  const selectFile = useUi((s) => s.selectFile);
  const seen = useProgress((s) => !!s.seen[file.id]);
  const toggleSeen = useProgress((s) => s.toggleSeen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div ref={ref} className={`frow${selected ? ' is-selected' : ''}${seen ? ' is-seen' : ''}${file.cosmeticOnly ? ' is-cosmetic' : ''}`}>
      <input
        type="checkbox"
        className="frow__seen"
        checked={seen}
        onChange={() => toggleSeen(file.id)}
        aria-label={`${baseName(file.path)} görüldü`}
        title="Görüldü (v)"
      />
      <button type="button" className="frow__btn" onClick={() => selectFile(file.id)} aria-current={selected ? 'true' : undefined} title={file.path}>
        {order !== undefined && <span className="frow__order gauge">{String(order).padStart(2, '0')}</span>}
        <FileStatusIcon status={file.status} />
        <span className="frow__name">
          <span className="frow__base">{baseName(file.path)}</span>
          {!compact && <span className="frow__dir">{compactDir(file.path)}</span>}
        </span>
        <span className="frow__meta">
          {file.cosmeticOnly && <span className="tag tag--cosmetic">kozmetik</span>}
          {file.isTest && <span className="tag">test</span>}
          <DeltaBar additions={file.additions} deletions={file.deletions} showNumbers={!compact} />
          <RiskBadge level={file.risk.level} score={file.risk.score} compact />
        </span>
      </button>
    </div>
  );
}

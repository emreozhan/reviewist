import type { FileChange } from '../../../../src/shared/types';
import { DeltaBar } from '../../components/DeltaBar';
import { FileStatusIcon } from '../../components/FileStatusIcon';
import { Icon } from '../../components/Icon';
import { RiskBadge } from '../../components/RiskBadge';
import { Segmented } from '../../components/Segmented';
import { LAYER_LABEL } from '../../lib/selectors';
import { baseName, dirName } from '../../lib/reviewIndex';
import { useProgress } from '../../state/progressStore';
import type { CenterView, DiffLayout } from '../../state/uiStore';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from './ReviewContext';

interface FileHeaderProps {
  file: FileChange;
  view: CenterView;
  hasStructure: boolean;
}

export function FileHeader({ file, view, hasStructure }: FileHeaderProps) {
  const { index, review } = useReviewCtx();
  const setView = useUi((s) => s.setCenterView);
  const layout = useUi((s) => s.diffLayout);
  const setLayout = useUi((s) => s.setDiffLayout);
  const seen = useProgress((s) => !!s.seen[file.id]);
  const toggleSeen = useProgress((s) => s.toggleSeen);
  const step = index.stepByFile.get(file.id);

  return (
    <div className="fhead">
      <div className="fhead__row">
        <FileStatusIcon status={file.status} />
        <h2 className="fhead__path" title={file.path}>
          <span className="fhead__dir">{dirName(file.path)}/</span>
          <span className="fhead__base">{baseName(file.path)}</span>
        </h2>
        <span className="fhead__meta">
          <span className="tag">{LAYER_LABEL[file.layer]}</span>
          {file.cosmeticOnly && <span className="tag tag--cosmetic">kozmetik</span>}
          <DeltaBar additions={file.additions} deletions={file.deletions} />
          <RiskBadge level={file.risk.level} score={file.risk.score} />
        </span>
        <span className="fhead__spacer" />
        {hasStructure && (
          <Segmented<CenterView>
            ariaLabel="Görünüm"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'structure', label: 'Yapı', title: 'Tip ve üye iskeleti' },
              { value: 'diff', label: 'Diff', title: 'Tam dosya farkı' },
            ]}
          />
        )}
        {view === 'diff' && (
          <Segmented<DiffLayout>
            ariaLabel="Diff düzeni"
            size="sm"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'unified', label: 'Birleşik' },
              { value: 'split', label: 'Yan yana' },
            ]}
          />
        )}
        <button type="button" className={`btn btn--sm seen-btn${seen ? ' is-on' : ''}`} aria-pressed={seen} onClick={() => toggleSeen(file.id)} title="Görüldü olarak işaretle (v)">
          <Icon name="check" /> {seen ? 'Görüldü' : 'Görüldü işaretle'}
        </button>
      </div>
      {file.oldPath && file.oldPath !== file.path && (
        <p className="fhead__old">
          Eski yol: <code>{file.oldPath}</code>
        </p>
      )}
      {step && (
        <p className="fhead__step">
          <span className="gauge">Adım {step.order}/{review.reviewPlan.length}</span> {step.reason}
        </p>
      )}
      {file.parseError && (
        <p className="fhead__warn" role="note">
          Java ayrıştırma hatası: {file.parseError}. Yapı görünümü eksik olabilir; Diff görünümünü kullanın.
        </p>
      )}
    </div>
  );
}

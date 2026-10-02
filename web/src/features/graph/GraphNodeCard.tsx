import type { ImpactNode } from '../../../../src/shared/types';
import { RiskBadge } from '../../components/RiskBadge';
import { StatusGlyph } from '../../components/StatusGlyph';
import { useOpenLocation } from '../../hooks/useNavigation';
import { locateSymbol } from '../../lib/locate';
import { KIND_LABEL } from '../../lib/labels';
import { baseName, findAnchor } from '../../lib/reviewIndex';
import { LAYER_LABEL } from '../../lib/selectors';
import { ExternalPreview } from '../inspector/ExternalPreview';
import { useReviewCtx } from '../workspace/ReviewContext';

interface GraphNodeCardProps {
  node: ImpactNode;
  onClose: () => void;
}

/** Seçili graf düğümünün ayrıntısı: diff içindeyse çalışma alanına git, değilse önizleme. */
export function GraphNodeCard({ node, onClose }: GraphNodeCardProps) {
  const { index } = useReviewCtx();
  const open = useOpenLocation();
  const inDiff = index.symbolFile.has(node.id);
  const anchor = inDiff ? undefined : findAnchor(index, node.id);
  const loc = inDiff ? undefined : locateSymbol(index, node.id);

  return (
    <aside className="gcard" aria-label="Seçili düğüm">
      <header className="gcard__head">
        <StatusGlyph status={node.status} withLabel />
        <button type="button" className="icon-btn icon-btn--sm" onClick={onClose} aria-label="Kapat">
          ×
        </button>
      </header>
      <h3 className="gcard__title">{node.label}</h3>
      <p className="gcard__meta">
        {KIND_LABEL[node.kind]} · {LAYER_LABEL[node.layer]} <RiskBadge level={node.riskLevel} compact />
      </p>
      {node.file && (
        <p className="gcard__file gauge" title={node.file}>
          {baseName(node.file)}
          {node.range ? `:${node.range.startLine}` : ''}
        </p>
      )}
      {inDiff ? (
        <button type="button" className="btn btn--primary btn--sm" onClick={() => open({ symbolIds: [node.id] })}>
          Çalışma alanında aç
        </button>
      ) : (
        <>
          <p className="gcard__note">Bu sembol diff dışında; değişmedi ama değişen koda bağlı.</p>
          {loc?.file && <ExternalPreview file={loc.file} line={loc.line} symbolId={node.id} side={loc.side} guessed={loc.guessed} />}
          {anchor && (
            <button type="button" className="btn btn--sm" onClick={() => open({ symbolIds: [anchor] })}>
              Etkileyen değişikliğe git
            </button>
          )}
        </>
      )}
    </aside>
  );
}

import type { ImpactNode } from '../../../../src/shared/types';
import { RiskBadge } from '../../components/RiskBadge';
import { StatusGlyph } from '../../components/StatusGlyph';
import { intentLinkProps, linkProps, useCodeNav } from '../../hooks/useCodeNav';
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
  const nav = useCodeNav();
  const inDiff = index.symbolFile.has(node.id);
  const anchor = inDiff ? undefined : findAnchor(index, node.id);
  const loc = inDiff ? undefined : locateSymbol(index, node.id);
  // Gözat: çalışma alanına geçip orta panelin önünde pencere açar (Shift: sekmede, Ctrl: arka plan sekmesi).
  const peek = (
    <button
      type="button"
      className="btn btn--primary btn--sm"
      title="Çalışma alanında gözatma penceresinde aç (Shift+tık: sekmede · Ctrl+tık: arka plan sekmesi)"
      {...intentLinkProps((intent) => void nav.openByIntent(node.id, intent, { from: 'top' }))}
    >
      Gözat
    </button>
  );

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
        <span className="gcard__actions">
          {peek}
          <button type="button" className="btn btn--sm" title="Ctrl+tık: arka plan sekmesi" {...linkProps((background) => void nav.openSymbol(node.id, { background }))}>
            Sekmede aç
          </button>
        </span>
      ) : (
        <>
          <p className="gcard__note">Bu sembol diff dışında; değişmedi ama değişen koda bağlı.</p>
          <span className="gcard__actions">
            {peek}
            <button type="button" className="btn btn--sm" title="Salt okunur kaynak sekmesi (Ctrl+tık: arka planda)" {...linkProps((background) => void nav.openSymbol(node.id, { background }))}>
              Sınıfını sekmede aç
            </button>
          </span>
          {loc?.file && <ExternalPreview file={loc.file} line={loc.line} symbolId={node.id} side={loc.side} guessed={loc.guessed} />}
          {anchor && (
            <button type="button" className="btn btn--sm" {...linkProps((background) => void nav.openSymbol(anchor, { background }))}>
              Etkileyen değişikliğe git
            </button>
          )}
        </>
      )}
    </aside>
  );
}

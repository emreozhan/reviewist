import { useMemo, useState } from 'react';
import type { Layer } from '../../../../src/shared/types';
import { VirtualList } from '../../components/VirtualList';
import type { LayerRow } from '../../lib/selectors';
import { LAYER_LABEL, layerRows, layerTree } from '../../lib/selectors';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FileRow } from './FileRow';

const rowKey = (r: LayerRow) => r.key;
const estimate = (r: LayerRow) => (r.kind === 'layer' ? 36 : r.kind === 'pkg' ? 20 : 32);

/** Katman → paket → dosya ağacı; katmanlar katlanır. Binlerce dosyada pencereli çizilir. */
export function LayerTree() {
  const { review, index } = useReviewCtx();
  const filters = useUi((s) => s.filters);
  const selected = useUi((s) => s.selectedFileId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<Layer>>(() => new Set());
  const tree = useMemo(() => layerTree(review, index, filters), [review, index, filters]);
  const rows = useMemo(() => layerRows(tree, collapsed), [tree, collapsed]);

  if (tree.length === 0) return <p className="nav__empty">Filtrelerle eşleşen dosya yok.</p>;

  const toggle = (layer: Layer) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });

  return (
    <VirtualList<LayerRow>
      className="tree"
      ariaLabel="Katman ağacı"
      items={rows}
      itemKey={rowKey}
      estimate={estimate}
      activeKey={selected ? `f:${selected}` : null}
      renderItem={(r) => {
        if (r.kind === 'layer') {
          return (
            <button type="button" className={`tree__summary layer--${r.node.layer}`} aria-expanded={r.open} onClick={() => toggle(r.node.layer)}>
              <span className="tree__caret" aria-hidden="true">{r.open ? '▾' : '▸'}</span>
              <span className="tree__layer-name">{LAYER_LABEL[r.node.layer]}</span>
              <span className="gauge tree__count">{r.node.count}</span>
            </button>
          );
        }
        if (r.kind === 'pkg') {
          return (
            <p className="tree__pkg-name" title={r.name}>
              {r.name}
            </p>
          );
        }
        return <FileRow file={r.file} compact />;
      }}
    />
  );
}

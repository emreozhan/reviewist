import { LAYER_LABEL, layerTree } from '../../lib/selectors';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { FileRow } from './FileRow';

/** Katman → paket → dosya ağacı (details/summary ile katlanır). */
export function LayerTree() {
  const { review, index } = useReviewCtx();
  const filters = useUi((s) => s.filters);
  const tree = layerTree(review, index, filters);

  if (tree.length === 0) return <p className="nav__empty">Filtrelerle eşleşen dosya yok.</p>;

  return (
    <div className="tree">
      {tree.map((layer) => (
        <details key={layer.layer} className={`tree__layer layer--${layer.layer}`} open>
          <summary className="tree__summary">
            <span className="tree__layer-name">{LAYER_LABEL[layer.layer]}</span>
            <span className="gauge tree__count">{layer.count}</span>
          </summary>
          {layer.packages.map((pkg) => (
            <div key={pkg.name} className="tree__pkg">
              <p className="tree__pkg-name" title={pkg.name}>
                {pkg.name}
              </p>
              {pkg.files.map((f) => (
                <FileRow key={f.id} file={f} compact />
              ))}
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}

import { useState } from 'react';
import { StatusGlyph } from '../../components/StatusGlyph';
import { CONFIDENCE_LABEL } from '../../lib/labels';
import type { PropItem } from '../../lib/propagation';
import { baseName } from '../../lib/reviewIndex';
import { useUi } from '../../state/uiStore';
import { useReviewCtx } from '../workspace/ReviewContext';
import { ExternalPreview } from './ExternalPreview';

/** Yayılım öğesi: diff içindeyse oraya gider; diff dışındaysa "etkilenen ama değişmeyen" önizlemesini açar. */
export function PropagationItem({ item, isCall }: { item: PropItem; isCall: boolean }) {
  const { index } = useReviewCtx();
  const selectSymbol = useUi((s) => s.selectSymbol);
  const goToLine = useUi((s) => s.goToLine);
  const [open, setOpen] = useState(false);
  // Dosya adı etiketteki tip adıyla aynıysa yalnız satırı göster (tekrarı önler).
  const typeName = item.label.split('.')[0];
  const fileName = item.file ? baseName(item.file) : '';
  const loc = !item.file
    ? 'konum bilinmiyor'
    : item.guessed
      ? `~${fileName}`
      : fileName === `${typeName}.java`
        ? (item.line ? `:${item.line}` : '')
        : `${fileName}${item.line ? `:${item.line}` : ''}`;

  const go = () => {
    if (!item.file) return;
    const symbolInDiff = index.symbolFile.has(item.id) ? item.id : undefined;
    if (isCall && item.line) goToLine(item.file, item.line, symbolInDiff);
    else if (symbolInDiff) selectSymbol(symbolInDiff, item.file);
    else if (item.line) goToLine(item.file, item.line);
  };

  const body = (
    <>
      {item.status ? <StatusGlyph status={item.inDiff ? item.status : 'impacted'} size="sm" /> : <span className="pitem__dot" aria-hidden="true" />}
      <span className="pitem__label">{item.label}</span>
      <span className="pitem__loc" title={item.guessed ? `Konum tahmini (paket adından): ${item.file}` : item.file}>{loc}</span>
      {item.confidence && item.confidence !== 'exact' && (
        <span
          className={`pitem__conf pitem__conf--${item.confidence}`}
          title={item.confidence === 'likely' ? 'Olası: alıcı tipi kesin çözülemedi, overload/arity ile eşlendi' : 'Yalnız ad eşleşmesi: doğrulanamadı'}
        >
          {CONFIDENCE_LABEL[item.confidence]}
        </span>
      )}
      {isCall && item.inDiff && item.inChangedCode === false && <span className="pitem__flag" title="Çağrı satırı bu diff'te değişmedi">satır değişmedi</span>}
    </>
  );

  if (item.inDiff) {
    return (
      <li className={`pitem pitem--in${item.confidence ? ` pitem--${item.confidence}` : ''}`}>
        <button type="button" className="pitem__btn" onClick={go} title={isCall ? 'Çağrı satırına git' : 'Bu sembole git'}>
          {body}
          <span className="pitem__go" aria-hidden="true">›</span>
        </button>
      </li>
    );
  }

  return (
    <li className={`pitem pitem--out${open ? ' is-open' : ''}${item.confidence ? ` pitem--${item.confidence}` : ''}`}>
      <button type="button" className="pitem__btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={!item.file} title="Diff dışı, değişmedi — önizlemeyi aç/kapat">
        {body}
        <span className="pitem__tag">diff dışı</span>
        <span className="pitem__go" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && item.file && <ExternalPreview file={item.file} line={item.line} symbolId={isCall ? undefined : item.id} side={item.side} guessed={item.guessed} />}
    </li>
  );
}

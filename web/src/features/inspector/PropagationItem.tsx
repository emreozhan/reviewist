import { useState } from 'react';
import { StatusGlyph } from '../../components/StatusGlyph';
import { intentLinkProps } from '../../hooks/useCodeNav';
import { useSymbolOpener } from '../../hooks/useSymbolOpener';
import { CONFIDENCE_LABEL } from '../../lib/labels';
import type { PropItem } from '../../lib/propagation';
import { baseName } from '../../lib/reviewIndex';
import { ExternalPreview } from './ExternalPreview';
import { BG_CLICK } from '../../lib/openIntent';

/**
 * Yayılım öğesi (çağıran, çağrılan, override, alt tip): tıklayınca sembol orta panelin önünde gözatma penceresinde
 * açılır (çağıranlarda çağrı satırına gidilir). Shift+tık: sekmede aç; Ctrl/Cmd+tık ya da orta tık: arka plan sekmesi.
 * Diff dışı öğelerde ▸ ile satır önizlemesi yerinde açılır.
 */
export function PropagationItem({ item, isCall }: { item: PropItem; isCall: boolean }) {
  const openSymbol = useSymbolOpener();
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

  // Çağrı yeri bilinen dosya/satırdır; diğerlerinde konum ReviewModel'den ya da /locate'ten bulunur.
  const hint = isCall && item.file ? { file: item.file, line: item.line, side: item.side, callSite: true } : undefined;
  const link = intentLinkProps((intent, origin, el) => void openSymbol(item.id, intent, { hint, origin, returnFocus: el }));

  return (
    <li className={`pitem ${item.inDiff ? 'pitem--in' : 'pitem--out'}${open ? ' is-open' : ''}${item.confidence ? ` pitem--${item.confidence}` : ''}`}>
      <div className="pitem__row">
        <button
          type="button"
          className="pitem__btn"
          title={`${isCall ? 'Çağrı satırını' : 'Kodunu'} pencerede aç${item.inDiff ? '' : ' (diff dışı, değişmedi)'} — Shift+tık: sekmede aç · ${BG_CLICK}: arka plan sekmesi`}
          {...link}
        >
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
          {!item.inDiff && <span className="pitem__tag">diff dışı</span>}
          <span className="pitem__go" aria-hidden="true">↗</span>
        </button>
        {!item.inDiff && item.file && (
          <button
            type="button"
            className="pitem__peek"
            aria-expanded={open}
            aria-label={`${item.label} satır önizlemesi`}
            title="Satır önizlemesini aç/kapat"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
      </div>
      {open && item.file && <ExternalPreview file={item.file} line={item.line} symbolId={isCall ? undefined : item.id} side={item.side} guessed={item.guessed} />}
    </li>
  );
}

import type { ReactNode } from 'react';
import type { ImpactNodeStatus } from '../../../src/shared/types';
import { linkProps, useCodeNav, intentLinkProps } from '../hooks/useCodeNav';
import { useSymbolOpener } from '../hooks/useSymbolOpener';
import { StatusGlyph } from './StatusGlyph';

interface SymbolLinkProps {
  id: string;
  label: string;
  status?: ImpactNodeStatus;
  /** Bilinen konum (çağrı yeri): verilirse sunucuya sorulmaz. */
  hint?: { file?: string; line?: number; side?: 'old' | 'new'; callSite?: boolean };
  detail?: ReactNode;
  className?: string;
  /** 'peek' (varsayılan): tık gözatma penceresi açar; 'tab': tık sınıfı sekmede açar (bulgular sayfası). */
  mode?: 'peek' | 'tab';
}

/**
 * Sembol bağlantısı: tık → gözatma penceresi (mode='tab' ise sınıfı yeni sekmede öne getirir);
 * Shift+tık → sekmede aç; Ctrl/Cmd+tık ya da orta tık → arka plan sekmesi.
 */
export function SymbolLink({ id, label, status, hint, detail, className, mode = 'peek' }: SymbolLinkProps) {
  const nav = useCodeNav();
  const openSymbol = useSymbolOpener();
  const props =
    mode === 'tab'
      ? linkProps((background) => void nav.openSymbol(id, { background, hint }))
      : intentLinkProps((intent, origin, el) => void openSymbol(id, intent, { hint, origin, returnFocus: el }));
  return (
    <button
      type="button"
      className={`slink${className ? ` ${className}` : ''}`}
      title={mode === 'tab' ? `${label} — sınıfını sekmede aç (Ctrl+tık: arka planda)` : `${label} — gözat (Shift+tık: sekmede aç · Ctrl+tık: arka plan sekmesi)`}
      {...props}
    >
      {status && <StatusGlyph status={status} size="sm" />}
      <span className="slink__label">{label}</span>
      {detail && <span className="slink__detail">{detail}</span>}
    </button>
  );
}

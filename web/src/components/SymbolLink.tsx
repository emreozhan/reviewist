import type { ReactNode } from 'react';
import type { ImpactNodeStatus } from '../../../src/shared/types';
import { linkProps, useCodeNav } from '../hooks/useCodeNav';
import { StatusGlyph } from './StatusGlyph';

interface SymbolLinkProps {
  id: string;
  label: string;
  status?: ImpactNodeStatus;
  /** Bilinen konum (çağrı yeri): verilirse sunucuya sorulmaz. */
  hint?: { file?: string; line?: number; side?: 'old' | 'new'; callSite?: boolean };
  detail?: ReactNode;
  className?: string;
}

/** Sembol bağlantısı: tık → sınıfı yeni sekmede öne gelir; Ctrl/Cmd+tık ya da orta tık → arka planda. */
export function SymbolLink({ id, label, status, hint, detail, className }: SymbolLinkProps) {
  const nav = useCodeNav();
  return (
    <button
      type="button"
      className={`slink${className ? ` ${className}` : ''}`}
      title={`${label} — sınıfını sekmede aç (Ctrl+tık: arka planda)`}
      {...linkProps((background) => void nav.openSymbol(id, { background, hint }))}
    >
      {status && <StatusGlyph status={status} size="sm" />}
      <span className="slink__label">{label}</span>
      {detail && <span className="slink__detail">{detail}</span>}
    </button>
  );
}

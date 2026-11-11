import type { ImpactNodeStatus } from '../../../src/shared/types';
import { STATUS_META } from '../lib/labels';

interface StatusGlyphProps {
  status: ImpactNodeStatus;
  /** Yanında metin etiketi de göster. */
  withLabel?: boolean;
  size?: 'sm' | 'md';
}

export function StatusGlyph({ status, withLabel = false, size = 'md' }: StatusGlyphProps) {
  const meta = STATUS_META[status];
  return (
    <span className={`status status--${status} status--${size}`} title={meta.label}>
      <span className="status__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      {withLabel ? <span className="status__label">{meta.label}</span> : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

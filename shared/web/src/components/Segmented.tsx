import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  badge?: number;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
}

/** Basılı/basılı değil düğmelerden oluşan seçim grubu. */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, size = 'md' }: SegmentedProps<T>) {
  return (
    <div className={`seg seg--${size}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`seg__btn${o.value === value ? ' is-active' : ''}`}
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.badge !== undefined && o.badge > 0 && <span className="seg__badge">{o.badge}</span>}
        </button>
      ))}
    </div>
  );
}

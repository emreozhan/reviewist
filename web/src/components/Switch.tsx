import type { ReactNode } from 'react';
import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  size?: 'sm' | 'md';
}

/** Erişilebilir anahtar: gerçek checkbox + role="switch". */
export function Switch({ checked, onChange, label, hint, size = 'md' }: SwitchProps) {
  const id = useId();
  return (
    <div className={`switch switch--${size}`}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <label htmlFor={id} className="switch__label">
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        <span>{label}</span>
      </label>
      {hint && (
        <p id={`${id}-hint`} className="switch__hint">
          {hint}
        </p>
      )}
    </div>
  );
}

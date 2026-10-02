import type { ReactNode } from 'react';

interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}

/** Etiket + girdi + ipucu/hata satırı. Hata, alanın adıyla birlikte gösterilir. */
export function Field({ id, label, hint, error, optional, children }: FieldProps) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {optional && <span className="field__opt">isteğe bağlı</span>}
      </label>
      {children}
      {error ? (
        <p className="field__error" id={`${id}-error`} role="alert">
          {label}: {error}
        </p>
      ) : (
        hint && (
          <p className="field__hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

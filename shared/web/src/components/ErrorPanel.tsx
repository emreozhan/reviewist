import type { ReactNode } from 'react';
import { errorHint, isApiError } from '../lib/api';

interface ErrorPanelProps {
  error: unknown;
  title?: string;
  action?: ReactNode;
}

/** ApiError ve beklenmeyen hataları Türkçe, yönlendirici biçimde gösterir. */
export function ErrorPanel({ error, title = 'İşlem tamamlanamadı', action }: ErrorPanelProps) {
  const api = isApiError(error) ? error : null;
  const message = error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
  return (
    <div className="error-panel" role="alert">
      <div className="error-panel__head">
        <span className="error-panel__mark" aria-hidden="true">!</span>
        <div>
          <p className="error-panel__title">{title}</p>
          <p className="error-panel__msg">{message}</p>
        </div>
      </div>
      {api && <p className="error-panel__hint">{errorHint(api)}</p>}
      {api?.detail && (
        <details className="error-panel__detail">
          <summary>Teknik ayrıntı</summary>
          <pre>{api.detail}</pre>
        </details>
      )}
      {api && (
        <p className="error-panel__meta">
          {api.endpoint}
          {api.status ? ` · HTTP ${api.status}` : ''}
        </p>
      )}
      {action && <div className="error-panel__action">{action}</div>}
    </div>
  );
}

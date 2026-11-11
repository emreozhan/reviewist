import type { FolderStatus } from './folderStatus';

interface FolderPickerFooterProps {
  status?: FolderStatus;
  onPick: (path: string) => void;
  onCancel: () => void;
}

/** Alt çubuk: seçilecek yol, git durumu ve eylemler. Git deposu olmayan klasör de seçilebilir (uyarıyla). */
export function FolderPickerFooter({ status, onPick, onCancel }: FolderPickerFooterProps) {
  return (
    <footer className="fp-foot">
      <div className="fp-foot__readout" aria-live="polite">
        {status ? (
          <>
            <span className="fp-foot__path" title={status.path}>
              {status.path}
            </span>
            <span className={`fp-state fp-state--${status.kind}`}>
              <span className="fp-state__led" aria-hidden="true" />
              {status.kind === 'repo' && 'Git deposu'}
              {status.kind === 'inside' && (
                <>
                  Bir git deposunun içinde: <span className="fp-state__root">{status.repoRoot}</span>
                  <button type="button" className="link-btn" onClick={() => onPick(status.repoRoot)}>
                    Kökü seç
                  </button>
                </>
              )}
              {status.kind === 'plain' && 'Git deposu değil; analiz için deponun kök dizini gerekir.'}
            </span>
          </>
        ) : (
          <span className="fp-foot__path muted">Klasör seçilmedi</span>
        )}
      </div>
      <div className="fp-foot__actions">
        <button type="button" className="btn" onClick={onCancel}>
          İptal
        </button>
        <button type="button" className="btn btn--primary" disabled={!status} onClick={() => status && onPick(status.path)}>
          Bu klasörü seç
        </button>
      </div>
    </footer>
  );
}

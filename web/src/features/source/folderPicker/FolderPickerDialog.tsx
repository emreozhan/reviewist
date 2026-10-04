import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Switch } from '../../../components/Switch';
import { isApiError } from '../../../lib/api';
import { pathCrumbs } from '../../../lib/fsPath';
import { loadRecentRepos } from '../../../lib/recentRepos';
import { FolderList } from './FolderList';
import { FolderPathBar } from './FolderPathBar';
import { FolderPickerFooter } from './FolderPickerFooter';
import { FolderSidebar } from './FolderSidebar';
import { folderStatus } from './folderStatus';
import { useFolderBrowser } from './useFolderBrowser';

interface FolderPickerDialogProps {
  /** Alanın mevcut değeri (mutlaksa pencere onun üst klasöründe, o klasör seçili açılır). */
  initialPath: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

function errorText(error: unknown): string {
  if (isApiError(error) && error.status === 403) {
    return error.message.startsWith('Bu klasöre erişim izni yok') ? error.message : `Bu klasöre erişim izni yok. ${error.message}`;
  }
  return error instanceof Error ? error.message : 'Klasör listesi alınamadı.';
}

/** "Klasör seç" penceresi: sunucu tarafı dizin listesiyle yerel repo yolu seçimi. */
export function FolderPickerDialog({ initialPath, onPick, onClose }: FolderPickerDialogProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [recent] = useState(() => loadRecentRepos());
  const b = useFolderBrowser(initialPath);
  const listing = b.listing;
  const status = listing ? folderStatus(listing, b.selectedEntry) : undefined;
  const errorParent = pathCrumbs(b.path).at(-2)?.path;

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Açılınca liste odaklanır; Esc kapatır; kapanınca odak açan düğmeye döner.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    listRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, []);

  // Odak tuzağı: Tab pencerenin içinde döner.
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const goRecent = (p: string) => {
    const parent = pathCrumbs(p).at(-2)?.path;
    if (parent) b.navigate(parent, p);
    else b.navigate(p);
    listRef.current?.focus();
  };
  const go = (p: string) => {
    b.navigate(p);
    listRef.current?.focus();
  };
  const pick = (p: string) => {
    onPick(p);
    onClose();
  };

  return createPortal(
    <div className="modal-backdrop fp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} className="fp" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={trapTab}>
        <header className="fp-head">
          <h2 id={`${id}-title`} className="fp-head__title">
            Klasör seç
          </h2>
          <p className="fp-head__sub">Yerel git deposunun kök dizinini seçin. Liste sunucunun bulunduğu makineden okunur.</p>
          <button type="button" className="icon-btn fp-head__close" onClick={onClose} aria-label="Kapat">
            ×
          </button>
        </header>
        <FolderSidebar roots={b.roots} recent={recent} current={listing?.path} onGo={go} onRecent={goRecent} />
        <section className="fp-main">
          <FolderPathBar id={id} path={b.shown?.path ?? b.path} onGo={go} onUp={listing?.parent ? b.goUp : undefined} loading={b.query.isFetching} />
          <div className="fp-body">
            {b.query.isError && !b.query.isFetching ? (
              <div className="fp-msg fp-msg--error" role="alert">
                <p>{errorText(b.query.error)}</p>
                <div className="fp-msg__actions">
                  {errorParent && (
                    <button type="button" className="btn btn--sm" onClick={() => go(errorParent)}>
                      Üst klasöre dön
                    </button>
                  )}
                  <button type="button" className="btn btn--sm" onClick={() => go('')}>
                    Ev dizinine git
                  </button>
                </div>
              </div>
            ) : !b.shown ? (
              <p className="fp-msg">Klasörler okunuyor…</p>
            ) : null}
            <FolderList id={id} browser={b} listRef={listRef} onConfirm={() => status && pick(status.path)} />
            {listing && listing.entries.length === 0 && <p className="fp-msg fp-msg--empty">Bu klasörde {b.hidden ? '' : 'görünür '}alt klasör yok.</p>}
          </div>
          <div className="fp-tools">
            <Switch size="sm" checked={b.hidden} onChange={b.setHidden} label="Gizli klasörleri göster" />
            {listing?.truncated && <span className="fp-tools__note">İlk {listing.entries.length} klasör gösteriliyor; yolu yazarak daraltın.</span>}
            <span className="fp-tools__keys" aria-hidden="true">
              ↑↓ gez · Enter gir · ⌫ üst · harf yaz: ada atla · Ctrl+Enter seç
            </span>
          </div>
        </section>
        <FolderPickerFooter status={status} onPick={pick} onCancel={onClose} />
      </div>
    </div>,
    document.body,
  );
}

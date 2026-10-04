import { lazy, Suspense, useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';

const FolderPickerDialog = lazy(async () => ({ default: (await import('./FolderPickerDialog')).FolderPickerDialog }));

interface FolderPathInputProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** Alan bırakılınca (blur/Enter) ya da pencereden seçilince, güncel değerle. */
  onCommit?: (v: string) => void;
  /** Pencereden seçim yapıldı (form düzenlendi sayılır). */
  onPicked?: () => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}

/** Yol kutusu + "Gözat…" düğmesi; düğme sunucu tarafı klasör seçici penceresini açar. */
export function FolderPathInput({ id, value, onChange, onCommit, onPicked, placeholder, invalid, describedBy }: FolderPathInputProps) {
  const [open, setOpen] = useState(false);
  const browseRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    // Odak, pencereyi açan düğmeye döner (klavyeyle devam edilebilsin).
    requestAnimationFrame(() => browseRef.current?.focus());
  };
  return (
    <div className="path-input">
      <input
        id={id}
        className="input input--mono"
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onCommit) {
            e.preventDefault();
            onCommit(value);
          }
        }}
      />
      <button ref={browseRef} type="button" className="btn path-input__browse" onClick={() => setOpen(true)} aria-haspopup="dialog" title="Klasörü pencereden seç">
        <Icon name="folder" />
        Gözat…
      </button>
      {open && (
        <Suspense fallback={null}>
          <FolderPickerDialog
            initialPath={value}
            onClose={close}
            onPick={(p) => {
              onChange(p);
              onCommit?.(p);
              onPicked?.();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

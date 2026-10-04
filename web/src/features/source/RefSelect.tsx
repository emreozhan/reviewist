import { useRef, useState } from 'react';
import type { GitRefs } from '../../../../src/shared/types';
import { Icon } from '../../components/Icon';
import { describeRef, REF_KIND_LABEL } from './refOptions';
import { RefSelectPopover } from './RefSelectPopover';

interface RefSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  refs?: GitRefs;
  loading?: boolean;
  /** Değer boşken düğmede görünen metin. */
  placeholder: string;
  /** Verilirse listenin başında değeri boşaltan seçenek (ör. 'HEAD (varsayılan)'). */
  emptyOption?: string;
  invalid?: boolean;
  describedBy?: string;
}

/** Dal seçici: seçili ref'i gösteren düğme + aranabilir, gruplu açılır liste (dal, uzak dal, etiket, son commit, serbest ref). */
export function RefSelect({ id, value, onChange, refs, loading, placeholder, emptyOption, invalid, describedBy }: RefSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shown = value.trim() ? describeRef(refs, value) : undefined;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  return (
    <div className={`refsel${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`refsel__trigger input${invalid ? ' is-invalid' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name={shown?.kind === 'commit' ? 'clock' : 'branch'} className="refsel__icon" />
        <span className={`refsel__value${shown ? '' : ' is-placeholder'}`}>{shown?.label ?? (loading ? 'Dallar yükleniyor…' : placeholder)}</span>
        {shown && shown.kind !== 'branch' && <span className="refsel__kind">{REF_KIND_LABEL[shown.kind]}</span>}
        <Icon name="chevronDown" className="refsel__chevron" />
      </button>
      {open && (
        <RefSelectPopover
          value={value}
          refs={refs}
          loading={loading}
          emptyOption={emptyOption}
          onPick={(v) => {
            onChange(v);
            close(true);
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

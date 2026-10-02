import { useState } from 'react';

interface DeleteReviewButtonProps {
  title: string;
  pending: boolean;
  onConfirm: () => void;
}

/** İki adımlı silme: ilk tıklama onay ister, ikincisi siler; odak kaybında vazgeçilir. */
export function DeleteReviewButton({ title, pending, onConfirm }: DeleteReviewButtonProps) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={`recent__del${armed ? ' is-armed' : ''}`}
      disabled={pending}
      aria-label={armed ? `"${title}" incelemesini silmeyi onayla` : `"${title}" incelemesini sil`}
      title={armed ? 'Silmek için tekrar tıklayın' : 'Sil'}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setArmed(false);
      }}
      onClick={() => {
        if (armed) onConfirm();
        else setArmed(true);
      }}
    >
      {pending ? '…' : armed ? 'Sil?' : '×'}
    </button>
  );
}

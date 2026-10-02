import { useId } from 'react';
import { useProgress } from '../../state/progressStore';

interface NoteEditorProps {
  noteKey: string;
  label: string;
}

/** Sembol/dosya notu; her değişiklikte localStorage'a yazılır. */
export function NoteEditor({ noteKey, label }: NoteEditorProps) {
  const id = useId();
  const value = useProgress((s) => s.notes[noteKey] ?? '');
  const setNote = useProgress((s) => s.setNote);
  const saveFailed = useProgress((s) => s.saveFailed);
  return (
    <section className="insp__sec note">
      <label htmlFor={id} className="insp__h">
        {label}
      </label>
      <textarea
        id={id}
        className="input textarea note__input"
        rows={3}
        value={value}
        placeholder="Review notu… (Markdown olarak dışa aktarılır)"
        onChange={(e) => setNote(noteKey, e.target.value)}
      />
      <p className="note__status" aria-live="polite">
        {saveFailed ? 'Uyarı: tarayıcı depolamasına yazılamadı.' : value.trim() ? 'Bu tarayıcıda saklandı.' : ''}
      </p>
    </section>
  );
}

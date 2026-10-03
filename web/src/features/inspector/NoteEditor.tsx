import { Section } from '../../components/Section';
import { useProgress } from '../../state/progressStore';

interface NoteEditorProps {
  noteKey: string;
  label: string;
}

/** Sembol/dosya notu; her değişiklikte localStorage'a yazılır. */
export function NoteEditor({ noteKey, label }: NoteEditorProps) {
  const value = useProgress((s) => s.notes[noteKey] ?? '');
  const setNote = useProgress((s) => s.setNote);
  const saveFailed = useProgress((s) => s.saveFailed);
  return (
    <Section id="insp.note" title={label} className="note" extra={value.trim() ? <span className="note__dot" title="Not var" aria-label="not var" /> : undefined}>
      <textarea
        aria-label={label}
        className="input textarea note__input"
        rows={3}
        value={value}
        placeholder="Review notu… (Markdown olarak dışa aktarılır)"
        onChange={(e) => setNote(noteKey, e.target.value)}
      />
      <p className="note__status" aria-live="polite">
        {saveFailed ? 'Uyarı: tarayıcı depolamasına yazılamadı.' : value.trim() ? 'Bu tarayıcıda saklandı.' : ''}
      </p>
    </Section>
  );
}

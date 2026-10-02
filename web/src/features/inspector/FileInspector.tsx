import type { FileChange } from '../../../../src/shared/types';
import { StatusGlyph } from '../../components/StatusGlyph';
import { fileNoteKey } from '../../lib/persistence';
import { baseName } from '../../lib/reviewIndex';
import { LAYER_LABEL } from '../../lib/selectors';
import { useUi } from '../../state/uiStore';
import { FindingCard } from '../findings/FindingCard';
import { useReviewCtx } from '../workspace/ReviewContext';
import { NoteEditor } from './NoteEditor';
import { RiskReasons } from './RiskReasons';

/** Sembol seçili değilken dosya düzeyi denetçi. */
export function FileInspector({ file }: { file: FileChange }) {
  const { index } = useReviewCtx();
  const selectSymbol = useUi((s) => s.selectSymbol);
  const findings = index.findingsByFile.get(file.id) ?? [];
  const types = file.typeIds.map((id) => index.typeById.get(id)).filter((t) => t !== undefined);

  return (
    <div className="insp__content">
      <header className="insp__subject">
        <p className="insp__kind">dosya · {LAYER_LABEL[file.layer]}</p>
        <h2 className="insp__name">{baseName(file.path)}</h2>
        {file.packageName && <p className="insp__where gauge">{file.packageName}</p>}
      </header>

      {types.length > 0 && (
        <section className="insp__sec">
          <h3 className="insp__h">Tipler</h3>
          <ul className="insp__types">
            {types.map((t) => (
              <li key={t.id}>
                <button type="button" className="pitem__btn" onClick={() => selectSymbol(t.id, file.id)}>
                  <StatusGlyph status={t.status} size="sm" />
                  <span className="pitem__label">{t.name}</span>
                  <span className="pitem__loc">{t.members.filter((m) => m.status !== 'unchanged').length} değişen üye</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RiskReasons risk={file.risk} />

      <section className="insp__sec">
        <h3 className="insp__h">İlgili testler</h3>
        {file.isTest ? (
          <p className="muted">Bu bir test dosyası.</p>
        ) : file.relatedTestFiles.length === 0 ? (
          <p className="warn-text">İlgili test bulunamadı.</p>
        ) : (
          <ul className="insp__tests">
            {file.relatedTestFiles.map((t) => (
              <li key={t} className="gauge" title={t}>
                {baseName(t)}
                {index.fileById.has(t) ? ' · bu diff\'te değişti' : ' · değişmedi'}
              </li>
            ))}
          </ul>
        )}
      </section>

      {findings.length > 0 && (
        <section className="insp__sec">
          <h3 className="insp__h">Bulgular</h3>
          <div className="insp__findings">
            {findings.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        </section>
      )}
      <NoteEditor noteKey={fileNoteKey(file.path)} label="Dosya notu" />
    </div>
  );
}

import { Modal } from '../../components/Modal';
import { useUi } from '../../state/uiStore';

const KEYS: [string, string][] = [
  ['j', 'Okuma planında sonraki dosya'],
  ['k', 'Okuma planında önceki dosya'],
  ['n', 'Sonraki görülmemiş dosya'],
  ['v', 'Seçili dosyayı görüldü olarak işaretle / kaldır'],
  ['/', 'Dosya veya sembol ara'],
  ['g', 'Etki haritası ↔ çalışma alanı'],
  ['?', 'Bu yardım'],
  ['Esc', 'Pencereyi kapat'],
];

export function ShortcutHelp() {
  const close = useUi((s) => s.setHelpOpen);
  return (
    <Modal title="Klavye kısayolları" onClose={() => close(false)}>
      <dl className="shortcut-list">
        {KEYS.map(([k, d]) => (
          <div key={k} className="shortcut-list__row">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">Kısayollar bir metin alanına yazarken devre dışıdır.</p>
    </Modal>
  );
}

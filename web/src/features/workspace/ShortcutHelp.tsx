import { Modal } from '../../components/Modal';
import { useUi } from '../../state/uiStore';

const KEYS: [string, string][] = [
  ['j', 'Okuma planında sonraki dosya'],
  ['k', 'Okuma planında önceki dosya'],
  ['n', 'Sonraki görülmemiş dosya'],
  ['v', 'Seçili dosyayı görüldü olarak işaretle / kaldır'],
  ['/', 'Dosya veya sembol ara'],
  ['g', 'Etki haritası ↔ çalışma alanı'],
  ['f', 'Odak modu: yan panelleri ve üst göstergeleri gizle / göster'],
  ['Alt+← / Alt+→', 'Gezinme geçmişinde geri / ileri (metot atlamaları)'],
  ['Ctrl+Tab / Alt+PageDown', 'Sonraki sekme (Ctrl+Tab tarayıcıya takılabilir)'],
  ['Ctrl+Shift+Tab / Alt+PageUp', 'Önceki sekme'],
  ['Alt+W', 'Etkin sekmeyi kapat (orta tık da kapatır)'],
  ['Ctrl+tık', 'Metodu / referansı arka plan sekmesinde aç (orta tık da)'],
  ['?', 'Bu yardım'],
  ['Esc', 'Pencereyi / menüyü kapat, odak modundan çık'],
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
      <p className="muted">
        Kısayollar bir metin alanına yazarken devre dışıdır. Ayraçlar: odaklanıp ←/→ (Shift ile büyük adım), Enter daraltır; çift tık varsayılan genişliğe döner.
      </p>
    </Modal>
  );
}

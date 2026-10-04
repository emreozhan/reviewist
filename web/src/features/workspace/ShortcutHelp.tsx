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
  ['Tık / Enter', 'Koddaki referansı, yayılım satırını ya da rozet menüsündeki sembolü önde gözatma penceresinde aç (pencere içinden açılan yenisi üstüne basamaklanır)'],
  ['Shift+tık', 'Referansı / sembolü doğrudan sekmede aç (öne gelir; gözatma yığını kapanır)'],
  ['Ctrl+tık', 'Metodu / referansı arka plan sekmesinde aç (orta tık da)'],
  ['Alt+↑ / Alt+↓', 'Gözatma yığınında odağı üst / alt pencereye taşı'],
  ['?', 'Bu yardım'],
  ['Esc', 'Menüyü / üstteki gözatma penceresini kapat (odak bir alttakine döner), odak modundan çık'],
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
        Kısayollar bir metin alanına yazarken devre dışıdır. Gözatma yığınında alttaki bir pencereye ya da kırıntı izindeki bir adıma tıklamak o seviyeye döner; pencereler başlıktan sürüklenir, sağ-alt köşeden boyutlandırılır. Ayraçlar: odaklanıp ←/→ (Shift ile büyük adım), Enter daraltır; çift tık varsayılan genişliğe döner.
      </p>
    </Modal>
  );
}

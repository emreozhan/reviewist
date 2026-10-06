import { Modal } from '../../components/Modal';
import { altLabel, modLabel } from '../../lib/platform';
import { shortcutRows } from '../../lib/shortcutRows';
import { useUi } from '../../state/uiStore';

const KEYS: [string, string][] = shortcutRows(modLabel, altLabel);

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
        Tek tuşlu kısayollar (j, k, n, v, /, g, f, ?) bir metin alanına yazarken devre dışıdır; {altLabel} ile kullanılanlar
        yazarken de çalışır (metin alanında {altLabel}+← / {altLabel}+→ imleci taşır). Onay kutusu ya da düğme odaktayken tüm kısayollar çalışır. Gözatma yığınında alttaki bir pencereye ya da kırıntı izindeki bir adıma tıklamak o seviyeye döner; pencereler başlıktan sürüklenir, sağ-alt köşeden boyutlandırılır. Ayraçlar: odaklanıp ←/→ (Shift ile büyük adım), Enter daraltır; çift tık varsayılan genişliğe döner.
      </p>
    </Modal>
  );
}

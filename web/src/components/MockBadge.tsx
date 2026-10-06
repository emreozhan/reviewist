import { navigate } from '../lib/route';
import { useApiMode } from '../state/apiMode';

/** Mock modunda her ekranda görünen açık etiket; gerçek API'ye dönüş düğmesiyle. */
export function MockBadge() {
  const mock = useApiMode((s) => s.mock);
  const disable = useApiMode((s) => s.disableMock);
  if (!mock) return null;
  return (
    <div className="mock-badge" role="status">
      <span className="mock-badge__dot" aria-hidden="true" />
      <span>
        <strong>ÖRNEK VERİ</strong> <span className="mock-badge__sub">örnek veri modu — sunucu kullanılmıyor</span>
      </span>
      <button
        type="button"
        className="mock-badge__btn"
        onClick={() => {
          disable();
          navigate({ name: 'home' });
        }}
      >
        Gerçek API'ye dön
      </button>
    </div>
  );
}

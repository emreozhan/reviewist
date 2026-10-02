import { useQueryClient } from '@tanstack/react-query';
import { navigate } from '../lib/route';
import { useApiMode } from '../state/apiMode';
import { Modal } from './Modal';

/** Sunucuya ulaşılamadığında kullanıcıya sorar: tekrar dene ya da örnek veriyle (mock) devam et. */
export function UnreachableDialog() {
  const open = useApiMode((s) => s.unreachablePrompt);
  const enableMock = useApiMode((s) => s.enableMock);
  const dismiss = useApiMode((s) => s.dismissPrompt);
  const queryClient = useQueryClient();

  if (!open) return null;

  const retry = async () => {
    dismiss();
    await queryClient.invalidateQueries();
  };
  const useMock = () => {
    enableMock();
    navigate({ name: 'home' });
  };

  return (
    <Modal
      title="Reviewist sunucusuna ulaşılamıyor"
      onClose={dismiss}
      actions={
        <>
          <button type="button" className="btn" onClick={() => void retry()}>
            Tekrar dene
          </button>
          <button type="button" className="btn btn--primary" onClick={useMock}>
            Örnek veriyle devam et
          </button>
        </>
      }
    >
      <p>
        Arayüz <code>/api</code> uçlarına bağlanamadı (beklenen adres <code>127.0.0.1:4317</code>). Sunucuyu{' '}
        <code>npm run dev:server</code> ile başlatıp tekrar deneyebilirsiniz.
      </p>
      <p className="muted">
        Örnek veri modu, hexagonal bir Java "shop" projesindeki hazır bir değişikliği gösterir. Bu modda gerçek depo okunmaz ve üst
        şeritte açıkça <strong>ÖRNEK VERİ</strong> etiketi görünür.
      </p>
    </Modal>
  );
}

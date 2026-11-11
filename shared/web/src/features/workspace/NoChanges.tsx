import type { ReviewSourceInfo } from '../../../../src/shared/types';

/** Review'da hiç değişen dosya yoksa: nedenini ve ne yapılabileceğini anlatır. */
export function NoChanges({ source }: { source: ReviewSourceInfo }) {
  return (
    <div className="center-empty center-empty--nochange" role="status">
      <p className="center-empty__title">Değişiklik yok</p>
      {source.kind === 'git' ? (
        <>
          <p className="muted">
            <code>{source.baseRef}</code> → <code>{source.headRef}</code> arasında incelenecek fark bulunamadı.
          </p>
          <p className="muted">
            PR semantiği (merge-base) açıkken yalnızca head dalında olup tabanda olmayan commit'ler gösterilir. Head tabanla aynıysa ya da tabanın
            gerisinde kalmış eski bir dalsa sonuç boştur. Taban ile head'i yer değiştirmeyi ya da PR semantiğini kapatmayı deneyin.
          </p>
        </>
      ) : source.kind === 'patch' ? (
        <p className="muted">Yapıştırılan metinde dosya farkı bulunamadı.</p>
      ) : source.headRef === 'WORKTREE' ? (
        <p className="muted">Çalışma ağacında commit edilmemiş değişiklik yok.</p>
      ) : (
        <p className="muted">Bu kaynakta değişen dosya yok.</p>
      )}
      <p>
        <a className="btn" href="#/">
          Kaynak seçimine dön
        </a>
      </p>
    </div>
  );
}

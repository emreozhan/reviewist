/**
 * Klavye yardımındaki satırlar; değiştirici tuş etiketleri platforma göre verilir (macOS: ⌘ / ⌥, diğerleri: Ctrl / Alt).
 * macOS'ta ⌥+harf başka karakter üretir; sekme geçişi `e.code` ile algılanır (Türkçe Q klavyede [ ve ] konumundaki
 * tuşlar Ğ ve Ü'dür).
 */
export function shortcutRows(mod: string, alt: string): [string, string][] {
  return [
    ['j', 'Okuma planında sonraki dosya'],
    ['k', 'Okuma planında önceki dosya'],
    ['n', 'Sonraki görülmemiş dosya'],
    ['v', 'Seçili dosyayı görüldü olarak işaretle / kaldır (çalışma alanında)'],
    ['/', 'Dosya veya sembol ara'],
    ['g', 'Etki haritası ↔ çalışma alanı'],
    ['f', 'Odak modu: yan panelleri ve üst göstergeleri gizle / göster'],
    [`${alt}+← / ${alt}+→`, 'Gezinme geçmişinde geri / ileri (metot atlamaları)'],
    [`${alt}+] / ${alt}+PageDown / Ctrl+Tab`, 'Sonraki sekme (Türkçe Q klavyede ] tuşu Ü; Ctrl+Tab tarayıcıya takılabilir)'],
    [`${alt}+[ / ${alt}+PageUp / Ctrl+Shift+Tab`, 'Önceki sekme (Türkçe Q klavyede [ tuşu Ğ)'],
    [`${alt}+W`, 'Etkin sekmeyi kapat (orta tık da kapatır)'],
    ['Tık / Enter', 'Koddaki referansı, yayılım satırını ya da rozet menüsündeki sembolü önde gözatma penceresinde aç (pencere içinden açılan yenisi üstüne basamaklanır)'],
    ['Shift+tık', 'Referansı / sembolü doğrudan sekmede aç (öne gelir; gözatma yığını kapanır)'],
    [`${mod}+tık`, 'Metodu / referansı arka plan sekmesinde aç (orta tık da)'],
    [`${alt}+↑ / ${alt}+↓`, 'Gözatma yığınında odağı üst / alt pencereye taşı'],
    ['?', 'Bu yardım'],
    ['Esc', 'Bir basış tek iş yapar: önce açık menü, yoksa üstteki gözatma penceresi (odak bir alttakine döner), o da yoksa odak modundan çık'],
  ];
}

/**
 * Sekme geçişi kısayolu: {Alt|⌥}+] / [ (`e.code` ile; ⌥ farklı karakter üretse de çalışır) ya da {Alt|⌥}+PageDown / PageUp.
 * Eşleşmezse 0.
 */
export function tabCycleDelta(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; key: string; code: string }): -1 | 0 | 1 {
  if (!e.altKey || e.ctrlKey || e.metaKey) return 0;
  if (e.code === 'BracketRight' || e.key === 'PageDown') return 1;
  if (e.code === 'BracketLeft' || e.key === 'PageUp') return -1;
  return 0;
}

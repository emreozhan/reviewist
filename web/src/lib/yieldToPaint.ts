/**
 * Ağır eşzamanlı işten (JSON.parse, indeks kurma) önce tarayıcının bir kare çizmesine izin verir:
 * böylece "Ayrıştırılıyor…" gibi durum metni ekranda görünür. Sekme arka plandaysa rAF beklenmez (zaman aşımı).
 */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(finish, 0));
    setTimeout(finish, 50);
  });
}

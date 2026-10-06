# Reviewist (hazır paket)

Java ağırlıklı büyük değişiklikleri (özellikle AI ile üretilmiş olanları) incelemeyi kolaylaştıran, tamamen yerelde
çalışan kod inceleme aracı. Bu dal yalnızca **çalıştırmak için gerekenleri** içerir: kurulum yok, derleme yok,
internet gerekmez. Kaynak kodu ve geliştirme ortamı `master` dalındadır.

## Gereksinimler

- **Node.js 20 veya üstü** — kontrol: `node -v`
- **git** — macOS'ta yoksa: `xcode-select --install`

## Çalıştırma

```bash
node bin/reviewist.js
```

Tarayıcıda `http://127.0.0.1:4317` açılır. Depo klasörünü **Gözat…** ile seçin, taban ve incelenecek dalı listeden
seçip **Analiz et**'e basın.

Doğrudan komut satırından:

```bash
node bin/reviewist.js /yol/depo --base main --head feature/x
```

```bash
node bin/reviewist.js /yol/depo --worktree
```

Tüm seçenekler: `node bin/reviewist.js --help`

## Bu makinede çalışıyor mu?

İsteğe bağlı öz-denetim (~5 sn): sunucuyu, Java analizini ve arayüzü geçici bir klasörde baştan sona dener.

```bash
node scripts/smoke.mjs
```

## Notlar

- Sunucu yalnızca `127.0.0.1` üzerinde dinler; kodunuz makinenizden çıkmaz, telemetri yoktur.
- git PATH'te bulunamazsa tam yolunu verin: `REVIEWIST_GIT=/opt/homebrew/bin/git node bin/reviewist.js`
- Belgeler / Masaüstü / İndirilenler altındaki depolar için macOS, terminal uygulamasına klasör erişim izni sorabilir.
- GitHub PR modu için token `GITHUB_TOKEN` ortam değişkeninden okunur (yalnızca `github.com`'a gönderilir).
- Koddaki bağlantılarda: tık = önde pencerede aç, Shift+tık = sekmede aç, ⌘+tık = arka planda sekme. `?` tüm kısayollar.

Lisans: MIT. Gömülü üçüncü taraf yazılımların lisansları: `dist/THIRD-PARTY-LICENSES.txt`

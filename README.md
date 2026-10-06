# Reviewist (kaynak kod)

Java ağırlıklı büyük değişiklikleri (özellikle AI ile üretilmiş olanları) incelemeyi kolaylaştıran, tamamen yerelde
çalışan kod inceleme aracı. Bu dal kaynak kodu içerir; derlenmiş paket `npm install` sırasında üretilir. Testler,
belgeler ve örnek depo `main` dalındadır; kurulum gerektirmeyen hazır paket `mac` dalındadır.

## Gereksinimler

- **Node.js 20 veya üstü** — kontrol: `node -v`
- **git** — macOS'ta yoksa: `xcode-select --install`
- `npm install` için npm kayıt defterine (registry) bir kerelik erişim; sonrası internet gerektirmez

## Kurulum ve çalıştırma

```bash
npm install
```

Bu adım bağımlılıkları kurar ve uygulamayı otomatik derler (`dist/`). Sonra:

```bash
npm start
```

Tarayıcıda `http://127.0.0.1:4317` açılır. Depo klasörünü **Gözat…** ile seçin, taban ve incelenecek dalı listeden
seçip **Analiz et**'e basın. Komut satırından doğrudan:

```bash
node bin/reviewist.js /yol/depo --base main --head feature/x
```

Tüm seçenekler: `node bin/reviewist.js --help`

Kurulumun bu makinede çalıştığını doğrulamak için (isteğe bağlı, ~5 sn):

```bash
npm run smoke
```

## Geliştirme

| Komut | Ne yapar |
| --- | --- |
| `npm run build` | `dist/` paketini yeniden üretir (kaynak değişince) |
| `npm run typecheck` | Sunucu ve arayüz tip denetimi |
| `npm run dev:server` + `npm run dev:web` | Sunucu (4317) ve canlı yenilenen Vite arayüzü (5173) |

## Notlar

- Sunucu yalnızca `127.0.0.1` üzerinde dinler; kodunuz makinenizden çıkmaz, telemetri yoktur.
- git PATH'te bulunamazsa: `REVIEWIST_GIT=/opt/homebrew/bin/git npm start`
- GitHub PR modu için token `GITHUB_TOKEN` ortam değişkeninden okunur (yalnızca `github.com`'a gönderilir).
- Koddaki bağlantılarda: tık = önde pencerede aç, Shift+tık = sekmede aç, ⌘+tık = arka planda sekme. `?` tüm kısayollar.

Lisans: MIT. Gömülü üçüncü taraf yazılımların lisansları derleme sonrası `dist/THIRD-PARTY-LICENSES.txt` içinde.

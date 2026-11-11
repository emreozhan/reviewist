# Reviewist

Java ağırlıklı büyük değişiklikleri (özellikle AI ile üretilmiş olanları) incelemeyi kolaylaştıran, **kendi
makinenizde çalışan** kod inceleme aracı.

Satır satır diff "bu değişiklik nereye gidiyor?" sorusuna cevap vermez. Reviewist değişikliği alır, Java kodunu
**sembol düzeyinde** (tip, metot, alan) çözer ve tarayıcıda şunları gösterir:

- **Semantik diff** — her üye için durum: eklendi, silindi, gövdesi değişti, imzası değişti, yeniden adlandırıldı,
  başka sınıfa taşındı ya da yalnızca biçimi değişti. Ayrıntılar somut: "parametre eklendi: String idempotencyKey",
  "@Transactional eklendi", "karmaşıklık 3 → 7".
- **Yayılım** — değişen metodu override eden alt sınıflar, arayüz implementasyonları, çağıranlar (diff içinde ve
  **diff dışında**) ve çağrılanlar.
- **Okuma planı** — önce sözleşmeler (arayüz, soyut sınıf, domain modeli), sonra bağımlılık sırasıyla implementasyonlar;
  her dosyanın testi hemen arkasında; yalnızca biçimi değişen dosyalar sonda.
- **Risk** — public API değişikliği, silinmiş ama hâlâ çağrılan üye, şablon metot değişikliği, anlam taşıyan
  anotasyonlar, equals/hashCode, boş catch, eşzamanlılık… Her neden puanıyla gösterilir.
- **Mimari ve test denetimi** — hexagonal mimari ihlalleri; değişen sınıfın testi var mı, güncellenmiş mi.
- **Akışı takip** — koddaki bir çağrıya tıklayınca hedef kod önde bir pencerede açılır; pencere içinden açılan yenisi
  üstüne basamaklanır. İstenirse IDE tarzı sekmelerde de açılır. Etki haritası, değişiklik grupları, görüldü
  işaretleri, notlar ve Markdown dışa aktarma da vardır.

## İki bağımsız uygulama

Depo, birbirinden bağımsız dağıtılabilen iki uygulama içerir. Her biri kendi klasöründe, **kurulum gerektirmeyen hazır
paketiyle** (`dist/`) durur; klasörü tek başına kopyalayıp çalıştırabilirsiniz. Gereken tek şey **Node.js 20+** ve
**git**; `npm install` gerekmez.

| | [Reviewist Yerel](local/README.md) (`local/`) | [Reviewist GitHub](github/README.md) (`github/`) |
| --- | --- | --- |
| Ne inceler | Bu makinedeki bir git deposu: iki dal/commit arası, commitlenmemiş çalışma ağacı, yapıştırılan patch | Uzak depo: GitHub PR'ı ya da bir deponun iki dalı |
| Kodu nasıl alır | Depoyu yerinde okur | `git clone` / `git fetch` ile yerel önbelleğe getirir |
| Ağ | **Hiç yok.** Uygulamada dış istek kodu bulunmaz; süreç içi çıkış bekçisi ve `git` için ağ kapalıdır | `git` uzak depoya bağlanır; uygulama yalnız PR başlığı/taban dalı için **tek** GitHub API isteği yapar |
| Başlat | `node local/bin/reviewist-local.js` | `node github/bin/reviewist-github.js` |
| Varsayılan adres | `http://127.0.0.1:4317` | `http://127.0.0.1:4318` |

```bash
git clone <depo-adresi> reviewist
```

```bash
cd reviewist
```

Her iki paketin bu makinede çalıştığını doğrulayan öz-denetim (isteğe bağlı, ~10 sn, ağa çıkmaz):

```bash
node scripts/smoke.mjs
```

Yerel depo incelemek için:

```bash
node local/bin/reviewist-local.js
```

Uzak depo / PR incelemek için:

```bash
node github/bin/reviewist-github.js
```

Yalnız birini dağıtmak isterseniz ilgili klasörü (`local/` ya da `github/`) kopyalamanız yeterlidir; diğer klasöre,
`shared/` kaynaklarına ya da `node_modules`'a ihtiyaç duymaz.

### macOS notları

- git yoksa: `xcode-select --install` (ya da Homebrew `brew install git`).
- Uygulama bir simge/başlatıcı üzerinden açıldığında PATH kısıtlı olabilir; Reviewist git'i bilinen kurulum yerlerinde de
  arar. Gerekirse yolu elle verin: `REVIEWIST_GIT=/opt/homebrew/bin/git node local/bin/reviewist-local.js`
- Belgeler / Masaüstü / İndirilenler altındaki depolar için macOS, terminal uygulamasına klasör erişim izni sorabilir.
- Koddaki bağlantılarda `Ctrl+tık` yerine `⌘+tık` kullanılır.

## Güvenlik ve gizlilik

Kodunuzun makineden çıkmaması tasarımın merkezindedir ve üç bağımsız katmanla korunur:

1. **Derleme zamanı — paket denetimi.** `npm run build`, pakete giren her kütüphaneyi ve içindeki ağ/süreç
   yeteneklerini bir izin listesiyle karşılaştırır ([scripts/lib/bundleAudit.mjs](scripts/lib/bundleAudit.mjs)).
   Listede olmayan bir kütüphane, bir kütüphanede yeni beliren bir yetenek (ör. bir güncellemeyle gelen `fetch`), yerel
   uygulamada herhangi bir dış istek kodu ya da arayüzde yasak bir tarayıcı API'si (WebSocket, `sendBeacon`, `eval`…)
   bulunursa derleme durur ve paket yazılmaz. Pakete giren kütüphaneler sürümleriyle `dist/BUILD.json` içindedir.
2. **Çalışma zamanı — çıkış bekçisi.** Sunucu süreci ve ayrıştırma işçileri açılışta Node'un ağ katmanını yamalar
   ([shared/src/runtime/egressGuard.ts](shared/src/runtime/egressGuard.ts)): `127.0.0.1` dışındaki her TCP bağlantısı,
   DNS sorgusu ve UDP gönderimi engellenir. Yerel uygulamada izin listesi boştur; GitHub uygulamasında yalnız GitHub
   API sunucularına (`api.github.com` + `REVIEWIST_GITHUB_HOSTS`) izin verilir. Yerel uygulama ayrıca `git`'i tüm
   taşıyıcılar kapalı (`protocol.allow=never`) çalıştırır.
3. **Tarayıcı — içerik güvenlik politikası.** Her yanıt `Content-Security-Policy: default-src 'none'; connect-src
   'self'; script-src 'self'; …` başlığıyla gelir: sayfa yalnız kendi yerel sunucusuna bağlanabilir, dış betik/resim/
   yazı tipi yükleyemez, satır içi betik çalıştıramaz, başka sayfaya gömülemez.

Ek olarak:

- Sunucu yalnızca `127.0.0.1` üzerinde dinler; başka sitelerden ve başka makinelerden gelen istekleri reddeder (Host,
  Origin ve `Sec-Fetch-Site` denetimleri). Aynı makinedeki diğer kullanıcı hesapları için kimlik doğrulaması yoktur;
  paylaşılan bir makinede sunucuyu açık bırakmayın.
- Arayüzün tüm dosyaları (yazı tipleri dahil) yerel sunucudan gelir; CDN, analitik ya da telemetri yoktur. Yapay zekâ
  servisi çağrısı yoktur; analiz kural tabanlıdır.
- İncelenen depo güvenilmez olabilir: git, depodaki hook'lar ve `fsmonitor` kapalı olarak çalıştırılır, sembolik bağlar
  izlenmez, `git` her zaman tam yoluyla çağrılır (depoya konmuş sahte bir `git.exe` çalışmaz).
- Çalışma zamanında **npm bağımlılığı yoktur**; paketler kurulum betiği çalıştırmaz.

> Bu katmanlar kazara ya da bir bağımlılık güncellemesiyle gelen veri sızıntısına karşıdır. Sürecin içinde kasıtlı ve
> gizlenmiş kötü amaçlı kodu durdurmayı garanti etmezler; en güçlü önlem işletim sistemi güvenlik duvarında `node`
> için giden bağlantıları kısıtlamaktır (yerel uygulama için tamamen kapatılabilir).

## Kullanım ipuçları

| Eylem | Sonuç |
| --- | --- |
| Koddaki çağrıya / yayılım satırına **tık** | Hedef kod önde bir gözatma penceresinde açılır (iç içe açılabilir) |
| **Shift+tık** | Hedef, sekmede açılır |
| **⌘/Ctrl+tık** ya da orta tık | Arka planda sekme açar |
| `j` / `k` | Okuma planında sonraki / önceki dosya |
| `n` · `v` | Sonraki görülmemiş · görüldü işaretle |
| `/` · `g` · `f` | Ara · etki haritası · odak modu |
| `Esc` | Üstteki pencereyi / menüyü kapat |
| `?` | Tüm kısayollar |

Panellerin arasındaki ayraçlar sürüklenebilir; görüldü işaretleri, notlar ve açık sekmeler tarayıcıda saklanır.
İncelemeler yalnız bellekte tutulur (en çok 20); sunucu kapanınca gider.

## Bilinen sınırlar

- Derin analiz yalnızca **Java** içindir; Kotlin ve diğer dosyalar düz diff olarak gösterilir.
- Çağıran ve aşırı yükleme (overload) çözümü derleyici değil, sezgiseldir; kesin eşleşmeler "olası" olanlardan ayrı
  işaretlenir. Test ve hexagonal mimari tespiti yol/paket adlarına dayanır.
- Repo indeksi en çok 5000 `.java` dosyasını kapsar; çok büyük etki grafikleri en riskli 600 düğümle sınırlanır.
- Uygulamaya özel sınırlar: [local/README.md](local/README.md), [github/README.md](github/README.md).

## Geliştirme

Geliştirme bağımlılıkları yalnızca kaynak kodu değiştirmek için gerekir (npm kayıt defterine erişim ister):

```bash
npm install
```

### Depo yapısı

```
shared/            iki uygulamanın ortak kaynağı (tek başına çalışmaz; derlemede her uygulamaya gömülür)
  src/core/        analiz motoru: tree-sitter Java, semantik diff, repo indeksi, risk, okuma planı
  src/sources/     yerel kaynaklar: git aralığı, çalışma ağacı, patch
  src/server/      Hono sunucusu (/api), güvenlik başlıkları, ortak başlatıcı (runServer)
  src/runtime/     çıkış bekçisi
  src/shared/      ortak veri modeli ve API tipleri (types.ts)
  web/             React arayüzü (uygulamaya göre derlenir: __EDITION__)
  vendor/          tree-sitter-java (wasm)
local/             Reviewist Yerel
  src/             komut satırı (ağ kodu içermez)
  bin/ dist/       çalıştırılabilir hazır paket (depoya işlenir)
github/            Reviewist GitHub
  src/             komut satırı + uzak depo kaynağı (git clone/fetch, PR bilgisi, önbellek)
  bin/ dist/       çalıştırılabilir hazır paket (depoya işlenir)
scripts/           build, paket denetimi, öz-denetim, fikstür
```

```
ReviewRequest → kaynak (yerel: shared/src/sources · uzak: github/src) → ChangeSet
ChangeSet     → shared/src/core   → ReviewModel
ReviewModel   → shared/src/server → shared/web
```

Mimari ve API özeti: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · gerçek depolarda doğruluk ölçümü (tarihsel kayıt):
[docs/QA-tur1.md](docs/QA-tur1.md)

### Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm start` · `npm run start:github` | Hazır paketi çalıştırır: yerel uygulama (`start`, `start:local` ile aynı) · GitHub uygulaması |
| `npm run dev:local` + `npm run dev:web` | Yerel uygulama: sunucu (4317) ve Vite arayüzü (5173); `?mock=1` ile sunucusuz örnek veri |
| `npm run dev:github` + `npm run dev:web:github` | GitHub uygulaması: sunucu (4318) ve Vite arayüzü (5173) |
| `npm test` | Tüm testler (Vitest). PATH'te git ≥ 2.32 gerekir; fikstür deposu yoksa kendisi üretir |
| `npm run typecheck` | Sunucu ve arayüz tip denetimi |
| `npm run build` | İki paketi (`local/dist`, `github/dist`) yeniden üretir; `build:local` / `build:github` tek tek |
| `npm run smoke` | Paketlerin tek başına (`node_modules` olmadan) çalıştığını ve kaynakla güncel olduğunu doğrular |
| `npm run fixture` | `fixtures/sample-repo` örnek Java deposunu kurar (beklenen sonuçlar: `fixtures/EXPECTED.md`) |
| `npm run test:perf` | Performans ölçümleri (süre eşikleriyle, tek başına) |

> **Önemli:** `local/dist` ve `github/dist` depoya işlenir. `shared/`, `local/src`, `github/src` ya da bağımlılıklar
> değiştiğinde `npm run build` çalıştırıp iki `dist/` klasörünü de commit edin; `npm run smoke` güncel olmayan paketi
> yakalar.

### Dış paketler

Aşağıdakilerin hepsi derlemede paketlerin içine gömülür; çalışma zamanında kurulmaz ve ağa çıkmaz.

| Paket | Ne için |
| --- | --- |
| `hono`, `@hono/node-server` | Yerel HTTP sunucusu |
| `web-tree-sitter` + `shared/vendor/tree-sitter-java` (wasm) | Java kaynağını sözdizim ağacına çevirme |
| `diff` | Satır farkı ve patch uygulama |
| `zod` | API isteklerinin doğrulanması |
| `react`, `@tanstack/react-query`, `zustand`, `@xyflow/react`, `@dagrejs/dagre`, `highlight.js`, `@fontsource/*` | Arayüz |

Yeni bir kütüphane eklemek ya da birini güncellemek paket denetimindeki izin listesini bilinçli olarak güncellemeyi
gerektirir. Gömülü yazılımların lisansları: [local/dist/THIRD-PARTY-LICENSES.txt](local/dist/THIRD-PARTY-LICENSES.txt),
[github/dist/THIRD-PARTY-LICENSES.txt](github/dist/THIRD-PARTY-LICENSES.txt)

## Lisans

[MIT](LICENSE)

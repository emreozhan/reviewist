# Reviewist

Java ağırlıklı büyük değişiklikleri (özellikle AI ile üretilmiş olanları) incelemeyi kolaylaştıran, **tamamen yerelde
çalışan** kod inceleme aracı.

Satır satır diff "bu değişiklik nereye gidiyor?" sorusuna cevap vermez. Reviewist bir git aralığını, commit edilmemiş
çalışma ağacını, bir GitHub PR'ını ya da yapıştırılmış bir patch'i alır; Java kodunu **sembol düzeyinde** (tip, metot,
alan) çözer ve tarayıcıda şunları gösterir:

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

## Hızlı başlangıç (kurulum yok)

Gereken tek şey **Node.js 20+** ve **git**. Depo, derlenmiş hazır paketi (`dist/`) içerir; `npm install` gerekmez ve
çalışırken internete ihtiyaç duyulmaz.

```bash
git clone <depo-adresi> reviewist
```

```bash
cd reviewist
```

Her şeyin bu makinede çalıştığını doğrulayan öz-denetim (isteğe bağlı, ~5 sn):

```bash
node scripts/smoke.mjs
```

Başlat:

```bash
node bin/reviewist.js
```

Tarayıcıda `http://127.0.0.1:4317` açılır; depo klasörünü **Gözat…** ile, dalları açılır listeden seçip **Analiz et**'e
basın. Komut satırından doğrudan da başlatılabilir:

```bash
node bin/reviewist.js /yol/depo --base main --head feature/x
```

```bash
node bin/reviewist.js /yol/depo --worktree
```

```bash
node bin/reviewist.js --pr https://github.com/sahip/depo/pull/123
```

Tüm seçenekler: `node bin/reviewist.js --help`

### macOS notları

- git yoksa: `xcode-select --install` (ya da Homebrew `brew install git`).
- Uygulama bir simge/başlatıcı üzerinden açıldığında PATH kısıtlı olabilir; Reviewist git'i bilinen kurulum yerlerinde de
  arar. Gerekirse yolu elle verin: `REVIEWIST_GIT=/opt/homebrew/bin/git node bin/reviewist.js`
- Belgeler / Masaüstü / İndirilenler altındaki depolar için macOS, terminal uygulamasına klasör erişim izni sorabilir.
- Koddaki bağlantılarda `Ctrl+tık` yerine `⌘+tık` kullanılır.

## Ağ ve gizlilik

| Mod | İnternet gerekir mi |
| --- | --- |
| Yerel git aralığı (`--base` / `--head`) | Hayır |
| Çalışma ağacı (`--worktree`) | Hayır |
| Patch yapıştırma | Hayır |
| GitHub PR (yalnız adresle) | Evet — PR bilgisi, dosya listesi ve içerikler `api.github.com` (ya da GitHub Enterprise) üzerinden; depo arşivi `codeload.github.com`'dan |
| GitHub PR + yerel klon | PR bilgisi API'den alınır, sonra PR yerel klona `git fetch` ile getirilir ve analiz yerelde yapılır |

- Sunucu yalnızca `127.0.0.1` üzerinde dinler; başka sitelerden ve başka makinelerden gelen istekleri reddeder. Aynı
  makinedeki diğer kullanıcı hesapları için kimlik doğrulaması yoktur; paylaşılan bir makinede sunucuyu açık bırakmayın.
- Arayüzün tüm dosyaları (yazı tipleri dahil) yerel sunucudan gelir; CDN, analitik ya da telemetri yoktur.
- Kodunuz makinenizden çıkmaz. Yapay zekâ servisi çağrısı yoktur; analiz kural tabanlıdır.
- İncelenen depo güvenilmez olabilir: git, depodaki hook'lar ve `fsmonitor` kapalı olarak çalıştırılır, sembolik bağlar
  izlenmez, `git` her zaman tam yoluyla çağrılır (depoya konmuş sahte bir `git.exe` çalışmaz).
- GitHub token'ı `GITHUB_TOKEN` / `GH_TOKEN` (ya da `--token-env AD`) ortam değişkeninden okunur ya da formda girilir;
  diske yazılmaz. Ortam değişkenindeki token **yalnızca `github.com`'a** gönderilir; GitHub Enterprise sunucuları için
  `REVIEWIST_GITHUB_HOSTS` ile izin verin ya da token'ı formda girin. `http://` adresler kabul edilmez.

### Ortam değişkenleri

| Değişken | Ne yapar |
| --- | --- |
| `GITHUB_TOKEN`, `GH_TOKEN` | GitHub PR modunda kullanılacak token (özel depolar ve saatlik istek sınırı için) |
| `REVIEWIST_GITHUB_HOSTS` | Ortam token'ının gönderilebileceği ek sunucular, virgülle ayrılmış (`git.sirket.com`) |
| `REVIEWIST_GIT` | git çalıştırılabilir dosyasının tam yolu (PATH'te bulunamıyorsa; Windows ve macOS) |
| `REVIEWIST_PERF` | `1` ise performans testlerindeki süre sınırları uygulanır |

### Yan etkiler

- GitHub PR + yerel klon modu, klona `refs/reviewist/pr-<n>` (gerekirse `…-base`) ref'lerini yazar; silmek için
  `git update-ref -d refs/reviewist/pr-<n>`.
- GitHub PR adres modunda depo arşivi geçici klasöre (`reviewist-gh-*`) açılır ve inceleme silinince ya da sunucu
  kapanınca temizlenir; bir günden eski kalıntılar bir sonraki açılışta süpürülür.
- İncelemeler yalnız bellekte tutulur (en çok 20); sunucu kapanınca gider. Görüldü işaretleri, notlar ve sekmeler
  tarayıcının `localStorage`'ında kalır.

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

## Bilinen sınırlar

- Derin analiz yalnızca **Java** içindir; Kotlin ve diğer dosyalar düz diff olarak gösterilir.
- Çağıran ve aşırı yükleme (overload) çözümü derleyici değil, sezgiseldir; kesin eşleşmeler "olası" olanlardan ayrı
  işaretlenir. Test ve hexagonal mimari tespiti yol/paket adlarına dayanır.
- Repo indeksi en çok 5000 `.java` dosyasını kapsar; çok büyük etki grafikleri en riskli 600 düğümle sınırlanır.
- GitHub adres modu: en çok 3000 değişen dosya, 200 MB arşiv; token'sız saatte 60 istek.
- Çalışma ağacı modu: en çok 2000 izlenmeyen dosya, dosya başına 5 MB.
- Patch modu: depo yolu verilirse klasör yamanın uygulanmış ya da uygulanmamış hâli olabilir; her ikisi de çözülür.
  Depo yolu yoksa yalnız yamadaki satırlar analiz edilir (çağıran bilgisi yok).

## Geliştirme

Geliştirme bağımlılıkları yalnızca kaynak kodu değiştirmek için gerekir (npm kayıt defterine erişim ister):

```bash
npm install
```

| Komut | Ne yapar |
| --- | --- |
| `npm run dev:server` + `npm run dev:web` | Sunucu (4317) ve Vite arayüzü (5173); `?mock=1` ile sunucusuz örnek veri |
| `npm test` | Tüm testler (Vitest). PATH'te git ≥ 2.32 gerekir; fikstür deposu yoksa kendisi üretir |
| `npm run typecheck` | Sunucu ve arayüz tip denetimi |
| `npm run build` | `dist/` paketini yeniden üretir |
| `npm run smoke` | Paketin `node_modules` olmadan çalıştığını ve kaynakla güncel olduğunu doğrular |
| `npm run fixture` | `fixtures/sample-repo` örnek Java deposunu kurar (beklenen sonuçlar: `fixtures/EXPECTED.md`) |
| `npm run sync-branches` | `mac` (yalnız hazır paket) ve `macClean` (yalnız kaynak) dallarını `main`'den yeniden üretir; `-- --push` ile gönderir |
| `npm run test:perf` | Performans ölçümleri (süre eşikleriyle, tek başına) |

> **Önemli:** `dist/` depoya işlenir. `src/`, `web/` ya da bağımlılıklar değiştiğinde `npm run build` çalıştırıp `dist/`
> klasörünü de commit edin; `npm run smoke` güncel olmayan paketi yakalar.

### Yapı

```
ReviewRequest → src/sources (git | çalışma ağacı | github | patch) → ChangeSet
ChangeSet     → src/core    (tree-sitter Java, semantik diff, repo indeksi, risk, plan) → ReviewModel
ReviewModel   → src/server  (Hono, /api) → web/ (React)
```

- Ortak veri modeli ve API uçları: `src/shared/types.ts`
- Mimari ve API özeti: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · gerçek depolarda doğruluk ölçümü (tarihsel kayıt):
  [docs/QA-tur1.md](docs/QA-tur1.md)

### Dış paketler

Çalışma zamanında **npm bağımlılığı yoktur**: aşağıdakilerin hepsi `dist/` içine gömülüdür, kurulumda betik
çalıştırmaz ve ağa çıkmaz.

| Paket | Ne için |
| --- | --- |
| `hono`, `@hono/node-server` | Yerel HTTP sunucusu |
| `web-tree-sitter` + `vendor/tree-sitter-java` (wasm) | Java kaynağını sözdizim ağacına çevirme |
| `diff` | Satır farkı ve patch uygulama |
| `zod` | API isteklerinin doğrulanması |
| `tar` | GitHub tarball'ından dosya çıkarma (yalnız PR adres modunda) |
| `react`, `@tanstack/react-query`, `zustand`, `@xyflow/react`, `@dagrejs/dagre`, `highlight.js`, `@fontsource/*` | Arayüz |

Gömülü yazılımların lisansları: [dist/THIRD-PARTY-LICENSES.txt](dist/THIRD-PARTY-LICENSES.txt)

## Lisans

[MIT](LICENSE)

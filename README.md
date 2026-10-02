# Reviewist

AI ile yapılmış büyük Java değişikliklerini review etmeyi kolaylaştıran, yerelde çalışan araç.

Düz satır diff'i "bu değişiklik nereye gidiyor?" sorusuna cevap vermez. Reviewist git diff'ini ya da GitHub PR'ını alır,
Java kodunu **sembol düzeyinde** (tip, metot, alan) analiz eder ve tarayıcıda şunları gösterir:

- **Semantik diff** — her üye için durum: eklendi, silindi, gövdesi değişti, imzası değişti, yeniden adlandırıldı,
  başka sınıfa taşındı, yalnızca biçim değişti. Değişiklik ayrıntıları Türkçe ve somut
  (`parametre eklendi: String idempotencyKey`, `@Transactional eklendi`, `karmaşıklık 3 → 7`).
- **Yayılım** — değişen metodu override eden alt sınıflar, davranışı devralan alt tipler, arayüz implementasyonları,
  çağıranlar (diff içinde ve **diff dışında**, kaynak önizlemesiyle) ve çağrılanlar.
- **Okuma planı** — önce sözleşmeler (arayüz/port, abstract sınıf, domain modeli), sonra bağımlılık sırasıyla
  implementasyonlar ve adapter'lar, her dosyanın testi hemen arkasında; yalnızca biçim değişen dosyalar en sonda.
- **Risk** — public API imza değişikliği, silinmiş ama hâlâ çağrılan üyeler, template method değişikliği,
  anlam taşıyan anotasyonlar (@Transactional, güvenlik, JPA, @Query…), equals/hashCode, boş catch, eşzamanlılık,
  karmaşıklık artışı… Her risk nedeni puanıyla gösterilir.
- **Hexagonal mimari denetimi** — domain'in framework'e/adapter'a bağımlılığı, controller'ın port yerine servisi
  enjekte etmesi, field injection gibi ihlaller (yeni gelenler ile önceden var olanlar ayrılır).
- **Test eşleme** — değişen üretim sınıfının testi var mı, bu diff'te güncellenmiş mi.
- **Değişiklik grupları ve etki haritası** — birbirine bağlı değişiklikleri "hikâye" olarak gruplar; grafikte gösterir.
- Görüldü işaretleri, sembol/dosya notları ve Markdown olarak dışa aktarma.

## Kurulum

```bash
npm install
```

```bash
npm run build
```

## Kullanım

Bir dal aralığını PR semantiğiyle (merge-base) incelemek için:

```bash
node bin/reviewist.js C:/yol/repo --base main --head feature/x
```

Commit edilmemiş değişiklikler (izlenmeyen dosyalar dahil):

```bash
node bin/reviewist.js C:/yol/repo --worktree
```

GitHub PR'ı (özel repolar için `GITHUB_TOKEN` ortam değişkeni):

```bash
node bin/reviewist.js --pr https://github.com/org/repo/pull/123
```

Argümansız çalıştırınca arayüzde kaynak seçilir (yerel git, çalışma ağacı, GitHub PR, patch yapıştırma).
Sunucu yalnızca `127.0.0.1:4317` üzerinde dinler. Tüm seçenekler: `node bin/reviewist.js --help`.

GitHub PR'ında yerel klon yolu verilirse PR `git fetch` ile alınıp yerelde analiz edilir; en hızlı ve en
eksiksiz yol budur (diff dışındaki çağıranlar için tüm repo indekslenir).

### Klavye

`j`/`k` sonraki/önceki dosya · `n` sonraki görülmemiş · `v` görüldü · `/` ara · `g` etki haritası · `?` yardım

## Geliştirme

```bash
npm run fixture
```

`fixtures/sample-repo` altında örnek hexagonal Java reposu kurar (`main...feature/ai-refactor` büyük AI tarzı refactor).
Beklenen analiz sonuçları `fixtures/EXPECTED.md` içinde.

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Arayüz `http://localhost:5173` (API'yi 4317'ye yönlendirir). `?mock=1` ile sunucusuz örnek veri.

```bash
npm test
```

```bash
npm run typecheck
```

Mimari ve şerit sözleşmeleri: [docs/CONTRACT.md](docs/CONTRACT.md). Ortak veri modeli: `src/shared/types.ts`.

```
ReviewRequest → sources (git | worktree | github | patch) → ChangeSet
ChangeSet → core/buildReview (tree-sitter Java, semantik diff, repo indeksi, risk, plan) → ReviewModel
ReviewModel → server (Hono /api) → web (React)
```

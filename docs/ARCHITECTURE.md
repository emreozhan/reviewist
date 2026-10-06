# Reviewist — mimari ve API özeti

Reviewist bir git aralığını, çalışma ağacını, GitHub PR'ını ya da patch'i alır; Java kodunu sembol düzeyinde analiz
eder ve sonucu yerel bir web arayüzüne sunar. Her şey tek bir Node süreci içinde çalışır; dış servis yoktur.

```
ReviewRequest ──> src/sources  (git | worktree | github | patch) ──> ChangeSet
ChangeSet     ──> src/core     (buildReview) ──> ReviewModel
ReviewModel   ──> src/server   (Hono, /api)  ──> web/ (React)
```

Ortak tipler ve API uçları tek yerde tanımlıdır: `src/shared/types.ts`. Sunucu ile arayüz yalnızca bu tipler
üzerinden konuşur.

## Katmanlar

| Katman | Yol | Görev |
| --- | --- | --- |
| Kaynaklar | `src/sources/` | `ChangeSet` üretir: değişen dosyalar + hunk'lar, iki taraftaki dosya içerikleri, depo dosya listesi. `git.ts` (aralık ve çalışma ağacı; içerik tek bir `git cat-file --batch` süreciyle okunur), `github.ts` (REST API ya da yerel klona `git fetch`), `patch.ts`, `unifiedDiff.ts`. Güvenlik yardımcıları `common.ts` (yol temizleme, sembolik bağ izlememe), git ikilisinin çözümü `gitBinary.ts`. |
| Java çekirdeği | `src/core/java/` | tree-sitter ile ayrıştırma (`extract.ts`), iki sürüm arasında üye eşleme ve durum çıkarımı (`semanticDiff.ts`), repo geneli çağrı/kalıtım indeksi (`repoIndex.ts`), işçi havuzu ve blob SHA önbelleği (`parsePool.ts`). |
| Analiz | `src/core/analysis/` | Katman tespiti, risk puanı, kozmetik ayrımı, mimari denetim, test eşleme, gruplama, okuma planı, etki grafiği, bulgular. Giriş noktası `src/core/buildReview.ts`; kod gezinme (`outline`/`locate`) `src/core/navigation.ts`. |
| Sunucu | `src/server/` | Hono uygulaması (`app.ts`), iş kuyruğu (`jobs.ts`), klasör seçici (`fsList.ts`), CLI (`cli.ts`). Yalnız `127.0.0.1` dinler. |
| Arayüz | `web/` | React 19 + Vite. Sunucu durumu TanStack Query, arayüz durumu Zustand. Özellik klasörleri: `source`, `workspace`, `navigator`, `structure`, `diff`, `inspector`, `peek` (gözatma pencereleri), `tabs`, `graph`, `findings`. |

## Analiz akışı (`buildReview`)

1. Değişen dosyalar için iskelet (`FileChange`): dil, katman, test mi, modül.
2. Java dosyalarının eski/yeni içerikleri okunur ve ayrıştırılır (işçi havuzu; blob SHA ile önbellek).
3. Semantik diff: tipler FQN ile, üyeler id → ad+tür → gövde benzerliği sırasıyla eşlenir; `renamed`/`moved`/`cosmetic`
   ayrımı yapılır; dosyalar arası taşımalar tespit edilir.
4. Repo indeksi: head tarafındaki tüm `.java` dosyaları (en çok `maxIndexFiles`, varsayılan 5000) ayrıştırılıp çağrı
   grafiği ve kalıtım ağacı kurulur. Çağrılar alıcı tipi, overload ve argüman tipleriyle çözülür; güven düzeyi
   `exact` / `likely` / `name-only`.
5. Zenginleştirme: üst/alt tipler, override ilişkileri, diff içi/dışı çağıranlar, silinmiş ama hâlâ çağrılan üyeler.
6. Katman, risk, kozmetik, mimari (hexagonal kurallar), test eşleme.
7. Gruplama (union-find; hub semboller köprü olmaz), okuma planı (sözleşmeler → bağımlılık sırası → adapter'lar →
   yapılandırma; testler ilgili dosyanın hemen arkasında; kozmetikler sonda), etki grafiği (en çok 600 düğüm), bulgular,
   özet.

Çok kökenli depolarda (aynı FQN birden çok kaynak kökünde) çakışan id'ler `@<kaynak kökü>` sonekiyle ayrılır.

## Kimlikler

- Tip: FQN (`com.acme.Outer.Inner`).
- Metot/yapıcı: `FQN#ad(ParamTip1,ParamTip2)` — parametre tipleri generic'siz basit ad, dizi `[]`, varargs `...`.
- Alan/enum sabiti: `FQN#ad`. Initializer: `FQN#<clinit>#0`.
- Anonim sınıf üyeleri: `<kapsayan üye id>$anon<n>#ad(...)` (yalnız `overriddenBy` listelerinde).

## HTTP API

Tüm uçlar JSON döner ve yalnız Reviewist arayüzünden kullanılmak üzere korunur (Host, Origin ve Sec-Fetch-Site denetimi).

| Uç | Açıklama |
| --- | --- |
| `GET /api/config` | Sürüm, varsayılan depo, token var mı, ilk inceleme id'si |
| `GET /api/git/refs?repoPath` | Dallar (ad ve son commit sırası), uzak dallar, etiketler, son commit'ler |
| `GET /api/fs/list?path&hidden` | Klasör seçici: alt klasörler (`.git` işaretli), kısayollar |
| `POST /api/jobs` → `GET /api/jobs/:id` | Analizi başlatır ve ilerlemesini verir (aynı anda en çok 2 analiz) |
| `POST /api/reviews` | Senkron analiz (geri uyumluluk) |
| `GET /api/reviews`, `GET /api/reviews/:id`, `DELETE /api/reviews/:id` | Bellekteki incelemeler (en çok 20, LRU) |
| `GET /api/reviews/:id/file?path&side` | Dosya içeriği (diff dışı dosyalar dahil) |
| `GET /api/reviews/:id/outline?path&side` | Dosyadaki bildirimler ve tıklanabilir referanslar (hedefleriyle) |
| `GET /api/reviews/:id/locate?id` | Bir sembolün konumu (diff içi/dışı, silinmiş) |

## Kalıcılık

- Sunucu: incelemeler yalnız bellekte; süreç kapanınca gider. Gezinme artefaktları son 3 inceleme için tutulur, düşenler
  ilk istekte yeniden kurulur.
- Arayüz: görüldü işaretleri, notlar ve açık sekmeler `localStorage`'da, kaynağın kararlı anahtarına
  (`ReviewSourceInfo.stableKey`) bağlı.

## Paketleme

`npm run build` (`scripts/build.mjs`): Vite arayüzü `dist/web`'e, esbuild sunucuyu tüm bağımlılıklarıyla
`dist/server/cli.js` ve `dist/server/parseWorker.js` dosyalarına derler; tree-sitter wasm dosyalarını kopyalar; üçüncü
taraf lisanslarını `dist/THIRD-PARTY-LICENSES.txt` olarak yazar; girdilerin özetini `dist/BUILD.json`'a koyar.
`dist/` depoya işlenir: indiren kişi `npm install` yapmadan `node bin/reviewist.js` ile çalıştırır. `node scripts/smoke.mjs`
paketin `node_modules` olmadan çalıştığını ve kaynakla güncel olduğunu doğrular.

## Fikstür ve testler

`npm run fixture` → `fixtures/sample-repo`: hexagonal bir Java "shop" deposu; `main` taban, `feature/ai-refactor`
büyük AI tarzı refactor, `feature/small-fix` küçük düzeltme. Beklenen analiz sonuçları `fixtures/EXPECTED.md`.
`npm test` fikstür yoksa onu kendisi üretir ve git'i kullanıcı yapılandırmasından yalıtır
(`scripts/vitest-global-setup.mjs`). Gerçek açık kaynak depolarında yapılan doğruluk ölçümü: `docs/QA-tur1.md`.

# Reviewist — mimari ve API özeti

Reviewist bir değişikliği (yerel git aralığı, çalışma ağacı, patch ya da uzak depo/PR) alır; Java kodunu sembol
düzeyinde analiz eder ve sonucu yerel bir web arayüzüne sunar. Depo, ortak bir çekirdeği paylaşan **iki bağımsız
uygulama** üretir:

| Uygulama | Klasör | Kaynaklar | Ağ |
| --- | --- | --- | --- |
| Reviewist Yerel (`reviewist-local`, port 4317) | `local/` | git aralığı, çalışma ağacı, patch | Yok (kod da yok, çalışma zamanında da engelli) |
| Reviewist GitHub (`reviewist-github`, port 4318) | `github/` | uzak depo / PR (`git fetch` ile yerel önbelleğe) | `git` → depo sunucusu; uygulama → yalnız GitHub API (PR bilgisi, tek istek) |

```
ReviewRequest ──> kaynak ──> ChangeSet ──> shared/src/core (buildReview) ──> ReviewModel ──> shared/src/server (/api) ──> shared/web
                   │
                   ├─ yerel:  shared/src/sources  (git | worktree | patch)
                   └─ uzak:   github/src          (remote → cache → git fetch → ortak git kaynağı)
```

Ortak tipler ve API uçları tek yerde tanımlıdır: `shared/src/shared/types.ts`. Sunucu ile arayüz yalnızca bu tipler
üzerinden konuşur. `shared/` tek başına çalışmaz; derlemede her uygulamanın `dist/` paketine gömülür, bu yüzden
uygulama klasörleri birbirinden ve `shared/`'dan bağımsız dağıtılır.

## Katmanlar

| Katman | Yol | Görev |
| --- | --- | --- |
| Yerel kaynaklar | `shared/src/sources/` | `ChangeSet` üretir: değişen dosyalar + hunk'lar, iki taraftaki dosya içerikleri, depo dosya listesi. `git.ts` (aralık ve çalışma ağacı; içerik tek bir `git cat-file --batch` süreciyle okunur; `disableGitNetwork()` ile tüm taşıyıcılar kapatılır), `patch.ts`, `unifiedDiff.ts`, istek doğrulama `index.ts` + `validation.ts`. Güvenlik yardımcıları `common.ts` (yol temizleme, sembolik bağ izlememe), git ikilisinin çözümü `gitBinary.ts`. |
| Uzak kaynak | `github/src/` | `remote.ts` (adres ayrıştırma: PR / depo / SSH / GHE), `cache.ts` (klon önbelleği ve depo kilidi), `source.ts` (`git ls-remote` + tek `git fetch`, sonra ortak `createGitChangeSet`; çalışma ağacına checkout yapılmaz), `prInfo.ts` (uygulamadaki **tek** dış istek), `token.ts` (token yalnız güvenilir sunuculara), `request.ts` (istek doğrulama). |
| Java çekirdeği | `shared/src/core/java/` | tree-sitter ile ayrıştırma (`extract.ts`), iki sürüm arasında üye eşleme ve durum çıkarımı (`semanticDiff.ts`), repo geneli çağrı/kalıtım indeksi (`repoIndex.ts`), işçi havuzu ve blob SHA önbelleği (`parsePool.ts`, `parseWorker.ts`). |
| Analiz | `shared/src/core/analysis/` | Katman tespiti, risk puanı, kozmetik ayrımı, mimari denetim, test eşleme, gruplama, okuma planı, etki grafiği, bulgular. Giriş noktası `shared/src/core/buildReview.ts`; kod gezinme (`outline`/`locate`) `shared/src/core/navigation.ts`. |
| Sunucu | `shared/src/server/` | Hono uygulaması (`app.ts`; uygulamaya göre `edition`, `parseRequest`, `createChangeSet`, `configExtras` ile yapılandırılır), iş kuyruğu (`jobs.ts`), klasör seçici (`fsList.ts`, yalnız yerel), ortak başlatıcı (`runServer.ts`). Yalnız `127.0.0.1` dinler. |
| Çalışma zamanı | `shared/src/runtime/` | Çıkış bekçisi (`egressGuard.ts`). |
| Komut satırı | `local/src/`, `github/src/cli.ts` | Argümanlar ve uygulamanın kablolanması. `local/src` hiçbir ağ modülü içe aktarmaz. |
| Arayüz | `shared/web/` | React 19 + Vite. Sunucu durumu TanStack Query, arayüz durumu Zustand. Uygulama ayrımı derleme sabitiyle (`__EDITION__`, `lib/edition.ts`): diğer uygulamanın formları pakete girmez. Özellik klasörleri: `source`, `workspace`, `navigator`, `structure`, `diff`, `inspector`, `peek` (gözatma pencereleri), `tabs`, `graph`, `findings`. |

## Güvenlik katmanları

1. **Paket denetimi (derleme)** — `scripts/lib/bundleAudit.mjs`. esbuild'in girdi listesi üzerinden: pakete giren her
   kütüphane izin listesinde mi; her kütüphanede yalnız bilinen yetenekler (`fetch`, `http`, soket, `child_process`,
   `eval`, WebSocket) mi var; proje kodunda bu yetenekler yalnız izinli dosyalarda mı (alt süreç: `git.ts`,
   `gitBinary.ts`, `openBrowser.ts`; `fetch`: yalnız `github/src/prInfo.ts`, yerel uygulamada hiçbir yerde); yerel pakete
   `github/` altından dosya girmiş mi. Arayüz paketinde: satır içi betik, dış kaynak, yasak tarayıcı API'leri,
   `data:` yazı tipi, beklenmeyen alan adı. Sorun varsa çıktı silinir ve derleme başarısız olur.
2. **Çıkış bekçisi (çalışma zamanı)** — `installEgressGuard({ allowHosts })`, `net.Socket.prototype.connect`'i, `dns`
   işlevlerini ve `dgram`'ı yamalar. Loopback ve IPC her zaman serbesttir; diğer hedefler yalnız izin listesindeyse
   geçer (yerel: boş; GitHub: `apiHostsAllowed()`). Engellenen deneme `EREVIEWIST_EGRESS` hatasıyla sonuçlanır ve
   konsola yazılır. İşçi iş parçacıkları (`parseWorker.ts`) bekçiyi izin listesiz kurar. `git` ayrı bir süreçtir ve
   bekçiye tabi değildir; yerel uygulamada `protocol.allow=never` + `GIT_NO_LAZY_FETCH=1` ile kapatılır.
3. **İçerik güvenlik politikası (tarayıcı)** — `app.ts` her yanıta `Content-Security-Policy` (`default-src 'none'`,
   `script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`…), `X-Content-Type-Options`, `Referrer-Policy`,
   `Cross-Origin-Opener-Policy` ve `Cross-Origin-Resource-Policy` ekler.

Bunlara ek olarak API; Host (DNS rebinding), Origin ve `Sec-Fetch-Site` denetimleriyle yalnız kendi arayüzünden
kullanılabilir. git; hook'lar ve `fsmonitor` kapalı, tam yoluyla, zaman aşımı ve çıktı sınırıyla çalıştırılır.

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

| Uç | Uygulama | Açıklama |
| --- | --- | --- |
| `GET /api/config` | ikisi | Sürüm, `edition`, ilk inceleme id'si; yerel: varsayılan depo; GitHub: token var mı, önbellek klasörü |
| `GET /api/git/refs?repoPath` | yalnız yerel | Dallar (ad ve son commit sırası), uzak dallar, etiketler, son commit'ler |
| `GET /api/fs/list?path&hidden` | yalnız yerel | Klasör seçici: alt klasörler (`.git` işaretli), kısayollar |
| `POST /api/jobs` → `GET /api/jobs/:id` | ikisi | Analizi başlatır ve ilerlemesini verir (aynı anda en çok 2 analiz). İstek gövdesi yerelde `git` / `worktree` / `patch`, GitHub'da `github` türündedir; diğer tür 400 ile reddedilir |
| `POST /api/reviews` | ikisi | Senkron analiz (geri uyumluluk) |
| `GET /api/reviews`, `GET /api/reviews/:id`, `DELETE /api/reviews/:id` | ikisi | Bellekteki incelemeler (en çok 20, LRU) |
| `GET /api/reviews/:id/file?path&side` | ikisi | Dosya içeriği (diff dışı dosyalar dahil) |
| `GET /api/reviews/:id/outline?path&side` | ikisi | Dosyadaki bildirimler ve tıklanabilir referanslar (hedefleriyle) |
| `GET /api/reviews/:id/locate?id` | ikisi | Bir sembolün konumu (diff içi/dışı, silinmiş) |

## Kalıcılık

- Sunucu: incelemeler yalnız bellekte; süreç kapanınca gider. Gezinme artefaktları son 3 inceleme için tutulur, düşenler
  ilk istekte yeniden kurulur.
- GitHub uygulaması: klon önbelleği diskte kalır (`<önbellek>/repos/<sunucu>/<sahip>/<depo>`); getirilen uçlar
  `refs/reviewist/*` altında tutulur.
- Arayüz: görüldü işaretleri, notlar ve açık sekmeler `localStorage`'da, kaynağın kararlı anahtarına
  (`ReviewSourceInfo.stableKey`) bağlı. İki uygulama farklı portta çalıştığı için tarayıcı depoları da ayrıdır.

## Paketleme

`npm run build` (`scripts/build.mjs`) her uygulama için: Vite arayüzü `<uygulama>/dist/web`'e (`__EDITION__` ile),
esbuild sunucuyu tüm bağımlılıklarıyla `<uygulama>/dist/server/cli.js` ve `parseWorker.js` dosyalarına derler; paket
denetimini çalıştırır; tree-sitter wasm dosyalarını kopyalar; üçüncü taraf lisanslarını `THIRD-PARTY-LICENSES.txt`
olarak yazar; sürümü, girdilerin özetini ve gömülü kütüphaneleri `BUILD.json`'a koyar. `local/dist` ve `github/dist`
depoya işlenir: indiren kişi `npm install` yapmadan `node local/bin/reviewist-local.js` ya da
`node github/bin/reviewist-github.js` ile çalıştırır. `node scripts/smoke.mjs` her uygulama klasörünü tek başına geçici
bir yere kopyalayıp uçtan uca çalıştırır ve paketlerin kaynakla güncel olduğunu doğrular.

## Fikstür ve testler

`npm run fixture` → `fixtures/sample-repo`: hexagonal bir Java "shop" deposu; `main` taban, `feature/ai-refactor`
büyük AI tarzı refactor, `feature/small-fix` küçük düzeltme. Beklenen analiz sonuçları `fixtures/EXPECTED.md`.
`npm test` fikstür yoksa onu kendisi üretir ve git'i kullanıcı yapılandırmasından yalıtır
(`scripts/vitest-global-setup.mjs`). Uzak kaynak testleri ağa çıkmaz: yerel çıplak depolar `file://` adresiyle
(`REVIEWIST_ALLOW_FILE_REMOTE=1`) uzak depo olarak kullanılır. Gerçek açık kaynak depolarında yapılan doğruluk ölçümü
(bölünmeden önceki tek uygulama düzeniyle, tarihsel kayıt): `docs/QA-tur1.md`.

# Reviewist Yerel

Bu makinedeki bir git deposundaki Java değişikliklerini inceler. **Ağa hiç çıkmaz**: internet bağlantısı olmayan ya da
dış erişimi kısıtlı bir makinede aynen çalışır.

Bu klasör tek başına bir uygulamadır. Gereken tek şey **Node.js 20+** ve **git**; `npm install` gerekmez. Klasörü
(`bin/`, `dist/`, `package.json`) istediğiniz yere kopyalayıp çalıştırabilirsiniz.

## Başlat

```bash
node bin/reviewist-local.js
```

Tarayıcıda `http://127.0.0.1:4317` açılır; depo klasörünü **Gözat…** ile, dalları açılır listeden seçip **Analiz et**'e
basın. Komut satırından doğrudan da başlatılabilir:

```bash
node bin/reviewist-local.js /yol/depo --base main --head feature/x
```

```bash
node bin/reviewist-local.js /yol/depo --worktree
```

Tüm seçenekler: `node bin/reviewist-local.js --help`

## Ne inceler

| Kaynak | Açıklama |
| --- | --- |
| Git aralığı | İki dal/etiket/commit; taban ile başın ortak atasından itibaren (PR görünümü) ya da doğrudan aralık |
| Çalışma ağacı | Commitlenmemiş değişiklikler (izlenmeyen dosyalar dahil) |
| Patch | Yapıştırılan unified diff; depo yolu verilirse çağıranlar da çözülür |

Uzak depolar ve GitHub PR'ları için ayrı uygulamayı kullanın: `reviewist-github` (depodaki `github/` klasörü).

## Ağ ve gizlilik

- Uygulamada dış istek yapan kod **yoktur**; derleme, pakete böyle bir kod girerse durur (paket denetimi).
- Sunucu süreci ve ayrıştırma işçileri açılışta çıkış bekçisini kurar: `127.0.0.1` dışındaki her TCP bağlantısı, DNS
  sorgusu ve UDP gönderimi engellenir.
- `git` tüm taşıyıcılar kapalı çalıştırılır (`protocol.allow=never`, `GIT_NO_LAZY_FETCH=1`): uygulama hiçbir koşulda
  `fetch`/`clone` yapmaz; kısmi klonlarda eksik nesne için de uzak depoya gidilmez.
- Sunucu yalnızca `127.0.0.1` üzerinde dinler; sayfa, içerik güvenlik politikasıyla yalnız kendi sunucusuna bağlanabilir.
- İncelenen depoya yazılmaz: hook'lar ve `fsmonitor` kapalıdır, indeks yeniden yazılmaz, sembolik bağlar izlenmez.

İsterseniz işletim sistemi güvenlik duvarında `node` için giden bağlantıları tamamen kapatabilirsiniz; uygulama
etkilenmez.

## Ortam değişkenleri

| Değişken | Ne yapar |
| --- | --- |
| `REVIEWIST_GIT` | git çalıştırılabilir dosyasının tam yolu (PATH'te bulunamıyorsa; Windows ve macOS) |

## Sınırlar

- Çalışma ağacı modu: en çok 2000 izlenmeyen dosya, dosya başına 5 MB.
- Patch modu: depo yolu verilirse klasör yamanın uygulanmış ya da uygulanmamış hâli olabilir; her ikisi de çözülür.
  Depo yolu yoksa yalnız yamadaki satırlar analiz edilir (çağıran bilgisi yok).
- İncelemeler yalnız bellekte tutulur (en çok 20); sunucu kapanınca gider. Görüldü işaretleri, notlar ve sekmeler
  tarayıcının `localStorage`'ında kalır.

## Paketin içeriği

`dist/BUILD.json` sürümü ve pakete gömülü kütüphaneleri (sürümleriyle) listeler; lisanslar
`dist/THIRD-PARTY-LICENSES.txt` içindedir. Kaynak kod ve derleme: depo kökündeki README.

[MIT](LICENSE)

# Reviewist GitHub

Uzak depolardaki Java değişikliklerini inceler: bir GitHub PR'ı ya da bir deponun iki dalı. Depo **git ile** yerel bir
önbelleğe getirilir (`git clone` / `git fetch`) ve analiz bu makinede yapılır.

Bu klasör tek başına bir uygulamadır. Gereken tek şey **Node.js 20+** ve **git**; `npm install` gerekmez. Klasörü
(`bin/`, `dist/`, `package.json`) istediğiniz yere kopyalayıp çalıştırabilirsiniz.

## Başlat

```bash
node bin/reviewist-github.js
```

Tarayıcıda `http://127.0.0.1:4318` açılır; PR ya da depo adresini girip **Analiz et**'e basın. Komut satırından doğrudan
da başlatılabilir:

```bash
node bin/reviewist-github.js https://github.com/sahip/depo/pull/12
```

```bash
node bin/reviewist-github.js sahip/depo --base main --head feature/x
```

Tüm seçenekler: `node bin/reviewist-github.js --help`

### Adres biçimleri

| Adres | Anlamı |
| --- | --- |
| `https://github.com/sahip/depo/pull/12` | PR (GitHub Enterprise: `https://sunucu/sahip/depo/pull/12`) |
| `sahip/depo#12` | github.com'daki PR (kısa) |
| `https://github.com/sahip/depo` · `sahip/depo` | Depo — incelenecek dal (`--head`) zorunlu; taban verilmezse varsayılan dal |
| `git@github.com:sahip/depo.git` | Depo, SSH ile |

Taban ile baş, ortak atalarından (merge-base) itibaren karşılaştırılır; GitHub'daki "Files changed" görünümüyle aynıdır.

## Kimlik doğrulama

- **Kod** git ile getirilir; özel depolar için git'in erişimi olmalıdır (credential helper ya da SSH anahtarı).
  Denemek için: `git ls-remote <adres>`. SSH tercih ediyorsanız `REVIEWIST_GIT_PROTOCOL=ssh` ayarlayın. Uygulama
  parola/kullanıcı adı sormaz (`GIT_TERMINAL_PROMPT=0`); SSH anahtarınız parolalıysa `ssh-agent` kullanın ve sunucunun
  anahtarını önceden kabul edin (aksi halde ssh, sunucunun çalıştığı terminalde soru sorup bekleyebilir).
- **PR bilgisi** (başlık, açıklama, taban dal) için tek bir GitHub API isteği yapılır. Özel depolarda ve saatlik istek
  sınırı için `GITHUB_TOKEN` / `GH_TOKEN` (ya da `--token-env AD`) ortam değişkenine token koyun. Token arayüzden
  girilmez, diske yazılmaz ve git'e verilmez. Bu istek başarısız olursa inceleme uyarıyla devam eder (PR'ın baş commit'i
  git'ten alınır; taban dal varsayılan dal sayılır ya da `--base` ile verilir).

## Ağ ve gizlilik

Bu uygulamanın ağ trafiği iki kalemden ibarettir:

| Ne | Nereye | Kim yapar |
| --- | --- | --- |
| `git ls-remote` + `git fetch` | Girdiğiniz deponun sunucusu | `git` alt süreci |
| `GET /repos/{sahip}/{depo}/pulls/{n}` (yalnız PR adresinde, bir kez) | `api.github.com` (ya da izin verdiğiniz GitHub Enterprise sunucusu) | Uygulama |

- Sunucu süreci ve ayrıştırma işçileri açılışta çıkış bekçisini kurar: GitHub API sunucuları (`api.github.com` +
  `REVIEWIST_GITHUB_HOSTS`) dışındaki her TCP bağlantısı, DNS sorgusu ve UDP gönderimi süreç içinde engellenir. Pakete
  gömülü kütüphaneler bu yüzden başka bir yere bağlanamaz.
- Ortam değişkenindeki token **yalnızca `github.com`'a** gönderilir; GitHub Enterprise sunucuları için
  `REVIEWIST_GITHUB_HOSTS` ile açıkça izin verin. `http://` adresler kabul edilmez.
- Sunucu yalnızca `127.0.0.1` üzerinde dinler; sayfa, içerik güvenlik politikasıyla yalnız kendi sunucusuna bağlanabilir.
- Getirilen depo güvenilmez sayılır: çalışma ağacına hiç checkout yapılmaz (yalnız `.git` nesneleri okunur), hook'lar
  ve `fsmonitor` kapalıdır, alt modüller getirilmez.
- Bu uygulamada yerel depo ve dosya sistemi uçları (`/api/git/refs`, `/api/fs/list`) **yoktur**; arayüz bu makinedeki
  klasörleri gezemez.

Güvenlik duvarı kuralı yazacaksanız: `node` için yalnız `api.github.com:443`, `git` için depo sunucunuz (HTTPS 443 ya
da SSH 22) yeterlidir.

## Önbellek

Her uzak depo `<önbellek>/repos/<sunucu>/<sahip>/<depo>` altında tutulur ve sonraki incelemelerde yalnız eksik nesneler
getirilir. Önbellek klasörü sırasıyla şuradan belirlenir: `--cache-dir` → `REVIEWIST_CACHE_DIR` → işletim sistemi
varsayılanı:

| Sistem | Varsayılan |
| --- | --- |
| macOS | `~/Library/Caches/reviewist-github` |
| Windows | `%LOCALAPPDATA%\reviewist-github\cache` |
| Linux | `$XDG_CACHE_HOME/reviewist-github` (yoksa `~/.cache/reviewist-github`) |

Önbelleği silmek güvenlidir (klasörü silin); bir sonraki incelemede depo yeniden getirilir. Kullanılan klasör açılışta
konsola ve arayüzdeki formun altına yazılır.

## Ortam değişkenleri

| Değişken | Ne yapar |
| --- | --- |
| `GITHUB_TOKEN`, `GH_TOKEN` | PR bilgisi isteğinde kullanılacak token |
| `REVIEWIST_GITHUB_HOSTS` | Token'ın gönderilebileceği ve API isteği yapılabilecek ek sunucular, virgülle ayrılmış (`git.sirket.com`) |
| `REVIEWIST_GIT_PROTOCOL` | `ssh` ise `sahip/depo` ve HTTPS adresleri SSH ile getirilir |
| `REVIEWIST_CACHE_DIR` | Klon önbelleği klasörü |
| `REVIEWIST_GIT` | git çalıştırılabilir dosyasının tam yolu (PATH'te bulunamıyorsa) |

## Sınırlar

- Çok büyük depolarda ilk getirme uzun sürebilir (zaman aşımı 15 dk); sonraki incelemeler artımlıdır.
- Token'sız GitHub API saatte 60 isteğe izin verir (inceleme başına bir istek).
- İncelemeler yalnız bellekte tutulur (en çok 20); sunucu kapanınca gider. Görüldü işaretleri, notlar, sekmeler ve son
  adresler tarayıcının `localStorage`'ında kalır.

Yerel depolar, commitlenmemiş değişiklikler ve patch'ler için ayrı uygulamayı kullanın: `reviewist-local` (depodaki
`local/` klasörü).

## Paketin içeriği

`dist/BUILD.json` sürümü ve pakete gömülü kütüphaneleri (sürümleriyle) listeler; lisanslar
`dist/THIRD-PARTY-LICENSES.txt` içindedir. Kaynak kod ve derleme: depo kökündeki README.

[MIT](LICENSE)

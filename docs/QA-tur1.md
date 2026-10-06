# Doğruluk ölçümü: gerçek Java depoları (QA turu 1, 2026-10-03)

**Durum: bu turda bulunan hataların tümü sonraki turda giderildi** (bkz. aşağıdaki tablo, "Çözüm" sütunu). Belge, ölçümün
nasıl yapıldığını ve aracın hangi sınıflarda hata yapabildiğini göstermek için tarihsel kayıt olarak tutulur.

Depolar: spring-petclinic, commons-lang, commons-collections, guava (24 commit aralığı + 2 çalışma ağacı senaryosu).
Yöntem: her aralık için üretilen ReviewModel, `git diff` / `git grep` ile elle karşılaştırıldı; bayat çağrı, taşıma ve
kozmetik iddiaları tek tek doğrulandı. Ölçüm betikleri depo dışında tutuldu (yeniden üretim için `npm run fixture` ve
`node scripts/smoke.mjs` yeterlidir; gerçek depolar klonlanıp `node bin/reviewist.js <depo> --base <a> --head <b>` ile
incelenebilir).

## Doğru çalışanlar
- Kozmetik üye tespiti: 3466 üye, 0 yanlış pozitif. Biçim/lisans/üye sıralama commit'leri doğru ayıklanıyor.
- Rename/move (aynı ad veya anlamlı gövde) doğru. `exact` çağıranlar `git grep` ile %100 kesin/kapsamlı. Alt tipler eksiksiz.
- Java 17–21 sözdizimi, Unicode dosya adı, ikili dosya, boş diff, hatalı ref, merge commit'li aralık: çökme yok.

## Hatalar (kod, kanıt, öneri)

| Kod | Önem | Konu | Çözüm |
| --- | --- | --- | --- |
| B1 | 🔴 | "Silinmiş ama hâlâ çağrılıyor" 81/81 yanlış pozitif | giderildi (analysis/enrich, findings, risk; java/repoIndex findCallsTo) |
| B2 | 🔴 | Arity değişikliği aynı arity'li başka overload yüzünden gizleniyor (yanlış negatif) | giderildi (analysis/enrich findStale) |
| B3 | 🔴 | Aynı FQN birden çok dosyada (guava flavor'ları) → tipler gölgeleniyor, 901/1853 dosya yanlış typeId | giderildi (buildReview uniqueTypes, enrich registerSymbols, repoIndex typeMap) |
| B4 | 🔴 | `Object @Nullable ... args` (varargs tip anotasyonu) ayrıştırma hatası → parametre ve sonraki ~30 metot kayboluyor | giderildi (java/extract (ön işleme)) |
| B5 | 🟡 | javax→jakarta import değişikliği "kozmetik" sayılıyor | giderildi (analysis/cosmetic) |
| B6 | 🟡 | `return null;` gibi önemsiz gövdeler dosyalar arası "moved" eşleşiyor (test↔main dahil) | giderildi (java/semanticDiff) |
| B7 | 🟡 | Git'in R%70 rename dediği dosyada tip removed+added çıkıyor (tutarsız) | giderildi (java/semanticDiff + buildReview) |
| B8 | 🟡 | Overload yalnız arity ile bağlanıyor: L1'de 14067 likely vs 5019 exact; `join` 69 çağıran (gerçek ~6) | giderildi (java/repoIndex bindMembers; analysis risk ağırlığı) |
| B9 | 🟡 | Tip parametresi adı değişimi (`T`→`E`) public API imza değişikliği sayılıyor | giderildi (java/semanticDiff) |
| B10 | 🟡 | Risk gürültüsü: `Objects.hashCode` null-check azalması sayılıyor; body-changed + likely çağıranlar high üretiyor | giderildi (java/extract nullChecks; analysis/risk) |
| B11 | 🟡 | "Override koptu" 4/4 yanlış pozitif (üst soyut bildirim kaldırıldı / metot üst arayüze taşındı) | giderildi (analysis/enrich) |
| B12 | 🟡 | Worktree + core.autocrlf=true: diskteki CRLF vs LF blob → 31/32 üye kozmetik | giderildi (sources/git worktree readFile) |
| B13 | 🟡 | Test eşleme statik alan erişimi (`TimeZones.GMT`) ve anotasyon argümanlarını referans saymıyor | giderildi (java/repoIndex filesBySimpleRef) |
| B14 | 🟡 | Dev gruplar (1151 sembol / 333 dosya): hashCode/equals gibi hub semboller her şeyi birleştiriyor | giderildi (analysis/grouping) |

### B1 ayrıntı
- (a) `findCallsTo` alıcı çözülemeyince `name-only` ekliyor, risk/bulgu güvene bakmıyor: `Shape#equals(Object)` ↔ `keys[i].equals(keys[j])`, `MD5Cyclic#getName()` ↔ `getClass().getName()`, `Processor#toString()` ↔ 52 alakasız çağrı.
- (b) Sahip tip silinince (`Pair.PairAdapter#getLeft()` private iç sınıf, `Pair#getLeft()` duruyor) `hierarchyHas` üst tiplere gidemiyor (`getType(owner)` undefined).
- (c) Açık argümansız yapıcı silindi → örtük varsayılan yapıcı devrede (`new TestBagUniqueSet()` derleniyor). C4'te 18 bulgu.
- (d) Çağrı başka metoda gidiyor: iç sınıf aynı metodu tanımlıyor (`ImmutableMap#createEntrySet()` / `IteratorBasedImmutableMap`); statik import (`Predicates.asList` → `Arrays.asList`).
- Öneri: name-only → en fazla info "doğrulanamadı"; likely → warning; yalnız exact → error. Head'de mevcut bir üyeye bağlanmış çağrı yeri bayat değildir (`targetsOfCallSite`). Yapıcı: head tipinde hiç yapıcı yoksa ve arity 0 ise geçerli. Silinen tipte eski modelin üst tiplerini head'de çözüp hiyerarşi kontrolü.

### B2 ayrıntı
`CharSequenceUtils#indexOf(CharSequence,int,int)` → 4 parametre; `indexOf(seq, searchChar, 0)` çağrıları artık derlenmiyor ama `indexOf(CharSequence,CharSequence,int)` overload'u var diye `stillCallable` true. Öneri: kalan overload'lara karşı `inferArgType` ile uyum kontrolü.

### B3 ayrıntı
guava: `guava/`, `android/guava/`, `guava-gwt/src-super`, `futures/` aynı FQN'leri içeriyor. 22 bulgu ve 58 plan sembol id'si modelde yok. Öneri: çift FQN'de id'yi kaynak köküyle ayır (`fqn@android/guava`), indeks çözümlemesinde aynı kaynak kökünü tercih et.

### B4 ayrıntı
tree-sitter-java `@Nullable Object @Nullable ... args` desteklemiyor. `Preconditions.checkArgument(boolean,String,Object...)` id'si `checkArgument(boolean,String)`; sınıf aralığı erken bitiyor. Öneri: ayrıştırmadan önce `Tip (@Ann(...)\s*)+...` içindeki anotasyonu aynı uzunlukta boşlukla değiştir (satır/sütun korunur). İndeks dosyalarındaki ayrıştırma hataları da sayılıp uyarıya yazılsın. 

### B6/B7/B9/B10/B11 ayrıntı
- B6: farklı ad eşleşmesinde en az ~15 token veya aynı parametre+dönüş tipi şartı; test yolu ↔ main yolu eşleşmesin. Örnek: `DynamicHasher.NoValuesIterator#hasNext()` → `SimpleBloomFilter#isSparse()` (critical!).
- B7: dosya git'te renamed ve her iki tarafta tek üst düzey tip varsa eşik ne olursa olsun `renamed`. Örnek: `BitMapProducer → BitMapExtractor` (R070).
- B9: imza karşılaştırmadan önce tip değişkenlerini pozisyona göre normalize et (`FailableRunnable#run()` throws T→E high:56).
- B10: `Objects.hashCode/equals/toString/requireNonNullElse` null-check sayılsın; diff dışı çağıran ağırlığı yalnız exact ile. `ConstantInitializer#hashCode` critical:85 yanlış.
- B11: alt metot head'de hâlâ bir şeyi override ediyorsa (overridesOf) kopma yok; yalnız `@Override` var ve hiçbir şey override edilmiyorsa error.

### Küçük
- `package-info`/`module-info` için plan "İçerik analiz edilemedi" diyor (yanıltıcı).
- Plan testleri yanlış konuya bağlıyor (`BitMapExtractorFromLongArrayTest` → IndexExtractor).
- "Repo indeksinde 1 dosya okunamadı" dosya adını vermiyor (NUL içeren `ClassUtilsOssFuzzTest.java` ikili sayılıyor).
- Yeni sabit gövdeli enum için "0 implementasyonun hepsi uygulamalı" uyarısı.
- Spring Data repository arayüzündeki `@Transactional(readOnly=true)` "yanlış katman" uyarısı + risk; yalnız biçim commit'inde 5 info.
- `guava-testlib` gibi test kütüphaneleri üretim kodu sayılıyor (99 "Test yok" uyarısının çoğu `*Tester`).
- Anonim sınıflar `overriddenBy`'da yok; anonim gövdede üye sıralaması "initializer modified".

## Performans
- Darboğaz Java ayrıştırma (guava G1 20 sn'nin %74'ü). commons-lang'de her review'da ~2 sn sabit indeks maliyeti; boş diff bile tüm repoyu indeksliyor.
- Bellek: lang ~290 MB, guava 833 MB. ReviewModel JSON: guava 39.8 MB (hunk 10.7 MB, değişmeyen üyeler 12 MB).
- Öneriler: worker_threads ayrıştırma havuzu; JavaFileModel'in blob SHA ile önbelleklenmesi; Java değişikliği yoksa indeks atlanması; HTTP gzip.

## Kullanılabilirlik
Küçük/orta PR'da çıktı isabetli ve yardımcı. Büyük değişiklikte gürültü kaynakları: yanlış "kırık çağrı" error'ları, likely çağıranlardan şişen uyarılar, dev gruplar, 1878 adımlık plan, tip parametresi/jakarta sınıflandırma hataları.

# Fikstür: beklenen analiz sonuçları (ground truth)

Depo `npm run fixture` ile `fixtures/sample-repo` altında üretilir (betik: `scripts/make-fixture.mjs`). Üretim deterministiktir;
aynı betik her çalıştırmada aynı SHA'ları verir. Betik değişirse SHA'lar değişir; testler SHA yerine dal adlarını kullanmalı.

- `main`: 2 commit, 45 dosya (40 `.java`: 35 üretim + 5 test).
- `feature/ai-refactor`: `main` + 3 commit. `main...feature/ai-refactor` = 28 dosya, +242 / −152 satır (git sayımı).
- `feature/small-fix`: `main` + 1 commit, 1 dosya.

Kısaltmalar: `S = com.acme.shop`, `P = src/main/java/com/acme/shop`, `T = src/test/java/com/acme/shop`.
Sembol id'leri `src/core/java/model.ts` → `JavaMember.id` biçimindedir (parametre tipleri generic'siz basit ad). Aşağıda id'ler
**tam** yazılmıştır; `S`/`P`/`T` yalnızca açıklama metninde kısaltmadır.

---

## 1. `feature/ai-refactor`: dosya düzeyi

`git diff -M --name-status main...feature/ai-refactor` ile birebir aynı olmalı:

| Durum | Yol | `cosmeticOnly` | `isTest` |
| --- | --- | --- | --- |
| modified | `pom.xml` | false | false |
| modified | `src/main/resources/application.yml` | false | false |
| modified | `P/adapter/in/web/OrderController.java` | false | false |
| modified | `P/adapter/in/web/OrderResponse.java` | false | false |
| **renamed** (`oldPath` = `P/adapter/in/web/OrderRequest.java`, benzerlik %97) | `P/adapter/in/web/dto/OrderRequest.java` | false | false |
| modified | `P/adapter/out/notification/AbstractNotifier.java` | false | false |
| modified | `P/adapter/out/notification/EmailNotifier.java` | false | false |
| modified | `P/adapter/out/notification/SmsNotifier.java` | false | false |
| modified | `P/adapter/out/notification/PushNotifier.java` | false | false |
| **deleted** | `P/adapter/out/notification/LegacyFaxNotifier.java` | false | false |
| modified | `P/adapter/out/payment/StripePaymentAdapter.java` | false | false |
| modified | `P/adapter/out/payment/PaypalPaymentAdapter.java` | false | false |
| modified | `P/adapter/out/persistence/OrderJpaRepository.java` | false | false |
| modified | `P/adapter/out/persistence/OrderMapper.java` | false | false |
| modified | `P/adapter/out/persistence/OrderPersistenceAdapter.java` | false | false |
| modified | `P/application/port/out/PaymentGateway.java` | false | false |
| modified | `P/application/service/CancelOrderService.java` | false | false |
| modified | `P/application/service/PlaceOrderService.java` | false | false |
| modified | `P/domain/model/Money.java` | false | false |
| modified | `P/domain/model/Order.java` | false | false |
| **added** | `P/domain/service/OrderValidator.java` | false | false |
| modified | `P/domain/service/PricingService.java` | false | false |
| modified | `P/util/ReportGenerator.java` | **true** | false |
| modified | `P/util/StringUtils.java` | false (üye silindi) | false |
| modified | `T/adapter/in/web/OrderControllerTest.java` | **true** (yalnızca import eklendi) | true |
| modified | `T/application/service/PlaceOrderServiceTest.java` | false | true |
| modified | `T/domain/model/OrderTest.java` | false | true |
| **added** | `T/domain/service/OrderValidatorTest.java` | false | true |

Özet beklentileri (`ReviewSummary`):

- `files` = 28, `javaFiles` = 26, `testFiles` = 4.
- `additions` = 242, `deletions` = 152 (git `--stat` ile aynı sayım kullanılırsa).
- `cosmeticFiles` = 2 (`ReportGenerator.java`, `OrderControllerTest.java`).
- Hiçbir dosyada `parseError` olmamalı; her iki dalda tüm `.java` dosyaları tree-sitter ile hatasız ayrışır (`hasErrors` = false).

Diff'e girmeyen ama analizde önemli dosyalar (head'de var, değişmedi):
`P/adapter/out/payment/PaymentReference.java`, `P/config/BeanConfig.java`, `T/domain/service/PricingServiceTest.java`,
`T/domain/model/MoneyTest.java`.

---

## 2. `feature/ai-refactor`: tip ve üye değişiklikleri

Listelenmeyen üyeler `unchanged` olmalı.

### 2.1 Arayüz imza değişikliği (madde 1)
- `com.acme.shop.application.port.out.PaymentGateway#charge(Money,String)`: **signatureChanged**,
  `oldId` = `com.acme.shop.application.port.out.PaymentGateway#charge(Money)`, flags ⊇ `params` (ayrıca `javadoc`).
  - `overriddenBy` = [`com.acme.shop.adapter.out.payment.StripePaymentAdapter#charge(Money,String)`,
    `com.acme.shop.adapter.out.payment.PaypalPaymentAdapter#charge(Money,String)`].
  - `callers` (head): `com.acme.shop.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)` (`inChangedCode` = true),
    test: `com.acme.shop.application.service.PlaceOrderServiceTest#shouldChargeAndPersistOrder_whenCommandIsValid()`,
    `com.acme.shop.application.service.PlaceOrderServiceTest#shouldRejectOrder_whenCommandHasNoLines()`.
- `com.acme.shop.adapter.out.payment.StripePaymentAdapter#charge(Money,String)`: **signatureChanged**, `oldId` = `...StripePaymentAdapter#charge(Money)`,
  flags ⊇ `params`, `body`; `overrides` = [`com.acme.shop.application.port.out.PaymentGateway#charge(Money,String)`].
- `com.acme.shop.adapter.out.payment.PaypalPaymentAdapter#charge(Money,String)`: **signatureChanged**, `oldId` = `...PaypalPaymentAdapter#charge(Money)`,
  flags ⊇ `params`, `body`; `overrides` aynı şekilde.
- `PaymentGateway` tipinin `subTypes` = [`com.acme.shop.adapter.out.payment.StripePaymentAdapter`, `com.acme.shop.adapter.out.payment.PaypalPaymentAdapter`].

### 2.2 Davranış değişikliği, çağıran diff dışında (madde 2)
- `com.acme.shop.domain.service.PricingService#calculateTotal(Order)`: **modified** (flags ⊇ `body`; yeni yüksek tutar indirimi + `totalAmount()` çağrısı).
  - `callers`: `com.acme.shop.adapter.in.web.OrderController#quote(OrderRequest)` (**diff dışı**, `inChangedCode` = false, satır 57),
    `com.acme.shop.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)` (`inChangedCode` = false; çağrı satırı değişmedi ama metot diff içinde),
    `PricingServiceTest` metotları (diff dışı test).
- `com.acme.shop.domain.service.PricingService#HIGH_VALUE_DISCOUNT_PERCENT`: **added** (alan).
- `com.acme.shop.domain.service.PricingService#HIGH_VALUE_THRESHOLD`: **added** (alan).
- `com.acme.shop.domain.service.PricingService#shippingCost(Order)`: **modified** (yalnızca `getTotal()` → `totalAmount()` çağrı değişikliği).
- `com.acme.shop.domain.service.PricingService#totalQuantity(Order)`: unchanged.

### 2.3 Abstract base template method + yeni abstract metot (madde 3, 4)
- `com.acme.shop.adapter.out.notification.AbstractNotifier#notify(Order)`: **modified** (flags ⊇ `body`; retry döngüsü, `channelName()` çağrısı,
  `e.printStackTrace()`); `overrides` = [`com.acme.shop.application.port.out.NotificationPort#notify(Order)`]; karmaşıklık artmalı (main: 1).
- `com.acme.shop.adapter.out.notification.AbstractNotifier#MAX_ATTEMPTS`: **added** (alan).
- `com.acme.shop.adapter.out.notification.AbstractNotifier#channelName()`: **added**, `modifiers` ⊇ `abstract`;
  `overriddenBy` = [`...EmailNotifier#channelName()`, `...SmsNotifier#channelName()`, `...PushNotifier#channelName()`] (tam id: `com.acme.shop.adapter.out.notification.<Ad>#channelName()`).
- `com.acme.shop.adapter.out.notification.EmailNotifier#channelName()`, `...SmsNotifier#channelName()`, `...PushNotifier#channelName()`: **added**.
- `EmailNotifier`, `SmsNotifier`, `PushNotifier` içindeki `format(Order)` ve `deliver(Customer,String)`: **unchanged**;
  ama `notify(Order)` davranışını kalıtımla aldıkları için bu üç tip **etkilenen** olarak gösterilmeli (bkz. bölüm 3).
- `AbstractNotifier` tipinin head'deki `subTypes` = [`...EmailNotifier`, `...PushNotifier`, `...SmsNotifier`] (LegacyFaxNotifier artık yok).
- `com.acme.shop.adapter.out.notification.AbstractNotifier#notify(Order)` çağıranları (port üzerinden, `NotificationPort#notify(Order)`):
  `PlaceOrderService#placeOrder(PlaceOrderCommand)`, `CancelOrderService#cancelOrder(String)` (ikisi de diff içinde), test `PlaceOrderServiceTest#shouldChargeAndPersistOrder_whenCommandIsValid()`.

### 2.4 Yeniden adlandırma (madde 5)
- `com.acme.shop.domain.model.Order#totalAmount()`: **renamed**, `oldId` = `com.acme.shop.domain.model.Order#getTotal()`, `oldName` = `getTotal`, gövde birebir aynı.
- Head'de `getTotal` adına çağrı **kalmamalı** (`findCallsTo('com.acme.shop.domain.model.Order', 'getTotal', 0)` boş).
- `totalAmount()` çağıranları (hepsi diff içinde, `inChangedCode` = true):
  `com.acme.shop.domain.service.PricingService#calculateTotal(Order)`, `com.acme.shop.domain.service.PricingService#shippingCost(Order)`,
  `com.acme.shop.adapter.out.persistence.OrderMapper#toEntity(Order)`, `com.acme.shop.adapter.in.web.OrderResponse#from(Order)`,
  `com.acme.shop.domain.model.OrderTest#shouldSumLineTotals_whenLinesAdded()`,
  `com.acme.shop.application.service.PlaceOrderServiceTest#shouldChargeAndPersistOrder_whenCommandIsValid()`.
- Değişen çağıran üyeler: `OrderMapper#toEntity(Order)` **modified**, `OrderResponse#from(Order)` **modified**.

### 2.5 Taşıma (madde 6)
- `com.acme.shop.domain.service.OrderValidator#validate(PlaceOrderCommand)`: **moved**,
  `oldId` = `com.acme.shop.application.service.PlaceOrderService#validate(PlaceOrderCommand)`; gövde birebir aynı (benzerlik 1.0),
  görünürlük `private` → `public` (details'te belirtilmeli).
- `PlaceOrderService#validate(PlaceOrderCommand)` ayrıca **removed** olarak görünmemeli; `OrderValidator#validate` ayrıca **added** olarak görünmemeli.
- `com.acme.shop.domain.service.OrderValidator` tipi: **added** (dosya da added).
- `com.acme.shop.application.service.PlaceOrderService#orderValidator`: **added** (alan, başlatıcı `new OrderValidator()`).
- `com.acme.shop.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)`: **modified** (`orderValidator.validate(...)`, `charge(amount, order.getId())`);
  `overrides` = [`com.acme.shop.application.port.in.PlaceOrderUseCase#placeOrder(PlaceOrderCommand)`].
- `com.acme.shop.application.service.PlaceOrderService#PlaceOrderService(OrderRepository,PaymentGateway,NotificationPort,PricingService)`: **unchanged**.
- `OrderValidator#validate(PlaceOrderCommand)` çağıranları: `PlaceOrderService#placeOrder(PlaceOrderCommand)` (diff içi), `OrderValidatorTest` metotları.

### 2.6 Yalnızca biçimsel değişiklik (madde 7)
- `P/util/ReportGenerator.java`: tüm girinti 4 boşluk → sekme, import sırası ters çevrildi. Dosya `cosmeticOnly` = true.
  Tüm üyeler **cosmetic** (flags ⊇ `formatting`):
  `com.acme.shop.util.ReportGenerator#DATE_FORMAT`, `#ReportGenerator()`, `#header(String,LocalDate)`, `#formatAmount(BigDecimal,String)`,
  `#formatRow(List,int)`, `#formatTable(List,List,int)`, `#padRight(String,int)` (hepsi `com.acme.shop.util.ReportGenerator#...`).
  Bu dosyanın risk seviyesi `low` olmalı; okuma planında en sonlarda yer almalı.
- `P/util/StringUtils.java`: aynı biçim dönüşümü + bir üye silindi (2.10). Kalan üyeler **cosmetic**:
  `com.acme.shop.util.StringUtils#StringUtils()`, `#isBlank(String)`, `#truncate(String,int)`, `#maskEmail(String)`, `#toUpperSnake(String)`.
  Dosya `cosmeticOnly` = false.
- `T/adapter/in/web/OrderControllerTest.java`: yalnızca `import com.acme.shop.adapter.in.web.dto.OrderRequest;` eklendi → `cosmeticOnly` = true, tüm üyeler unchanged.

### 2.7 Riskli değişiklikler (madde 8)
- `com.acme.shop.application.service.CancelOrderService#cancelOrder(String)`: `@Transactional` eklendi; flags ⊇ `annotations`,
  details '@Transactional eklendi' içermeli. Durum `modified` (gövde değişmedi; `signatureChanged` da kabul — bkz. not 6.1).
  `overrides` = [`com.acme.shop.application.port.in.CancelOrderUseCase#cancelOrder(String)`].
- `com.acme.shop.domain.model.Money#equals(Object)`: **modified** (currency karşılaştırması kaldırıldı).
- `com.acme.shop.domain.model.Money#hashCode()`: **modified** (currency hash'ten çıkarıldı).
  Risk: equals/hashCode sözleşmesi değişti (değer nesnesi semantiği); `high` veya üstü beklenir.
- `com.acme.shop.adapter.out.persistence.OrderPersistenceAdapter#findById(String)`: **modified**; `features.emptyCatches` = 1
  (`catch (Exception e) {}` — satır 29), hata yutulup `Optional.empty()` dönüyor.
- `com.acme.shop.adapter.out.persistence.OrderJpaRepository#findLargeOrdersByStatus(String,BigDecimal)`: **added**;
  annotations ⊇ `@Query("SELECT o FROM ...")`, `features.sqlStrings` = 1 (satır 13).
- `com.acme.shop.adapter.out.notification.AbstractNotifier#notify(Order)`: `features.printStackTrace` = 1 (satır 22).

### 2.8 Mimari ihlaller (madde 9) — yalnızca bu dalda ortaya çıkanlar
- `P/domain/model/Order.java`: domain katmanında Spring bağımlılığı — `import org.springframework.stereotype.Component;` (satır 7) ve tip
  anotasyonu `@Component` (satır 12). `com.acme.shop.domain.model.Order` tipi flags ⊇ `annotations`.
- `P/adapter/in/web/OrderController.java`:
  - `@Autowired` alan enjeksiyonu: `com.acme.shop.adapter.in.web.OrderController#placeOrderService` (**added** alan, satır 30-31).
  - Inbound adapter, inbound port yerine application servisine bağımlı: `import com.acme.shop.application.service.PlaceOrderService;` (satır 6).
  - `com.acme.shop.adapter.in.web.OrderController#placeExpressOrder(OrderRequest)`: **added**; `PlaceOrderService#placeOrder(PlaceOrderCommand)` doğrudan çağrılıyor.
- Taşımanın yan etkisi (ek ihlal): `P/domain/service/OrderValidator.java` → `import com.acme.shop.application.port.in.PlaceOrderCommand;` (satır 3):
  domain → application bağımlılığı (bağımlılık yönü ters).
- `main` dalında mimari ihlal **yok**; `CancelOrderService` üzerindeki `@Transactional` application servisinde olduğu için ihlal değil (risk olarak raporlanır).

### 2.9 Diğer üye değişiklikleri
- `com.acme.shop.adapter.in.web.OrderController`: `#placeOrder(OrderRequest)`, `#quote(OrderRequest)`, `#cancel(String)` ve yapıcı **unchanged**;
  `#placeOrderService` ve `#placeExpressOrder(OrderRequest)` **added**.
- `OrderRequest` taşındı: tip id `com.acme.shop.adapter.in.web.dto.OrderRequest`, `oldId` = `com.acme.shop.adapter.in.web.OrderRequest`
  (tip durumu `moved`; `renamed` da kabul). İç tip `...dto.OrderRequest.LineRequest` (eski `...web.OrderRequest.LineRequest`).
  `#toCommand()` ve `#toDraftOrder()` gövdeleri aynı: removed+added çifti olarak **raporlanmamalı**.
- `com.acme.shop.adapter.out.notification.LegacyFaxNotifier`: tip **removed** (dosya deleted); üyeleri `#LOG`, `#format(Order)`,
  `#deliver(Customer,String)` removed. Head'de bu tipe referans yok (silme güvenli; `removed-with-callers` **olmamalı**).

### 2.10 Silinmiş ama hâlâ çağrılan (madde 10)
- `com.acme.shop.util.StringUtils#legacyPad(String,int)`: **removed**.
- Head'de çağıran **kalıyor**: `com.acme.shop.adapter.out.payment.PaymentReference#next(String)` —
  `P/adapter/out/payment/PaymentReference.java` satır 14 (dosya diff dışında). Bu kod derlenmez.
  Beklenen: `error` şiddetinde bulgu ("silinmiş ama hâlâ çağrılıyor"), risk `critical`.

### 2.11 Java dışı (madde 12)
- `pom.xml`: `org.springframework.retry:spring-retry` bağımlılığı eklendi (+4 satır).
- `src/main/resources/application.yml`: `spring.jpa.hibernate.ddl-auto` `validate` → `update` (şema otomatik değiştirilir; riskli ayar).

---

## 3. Diff dışında etkilenen semboller (`impacted`)

En az şunlar `ImpactNode.status = 'impacted'` olmalı ve `summary.impactedOutsideDiff` ≥ 6:

- `com.acme.shop.adapter.in.web.OrderController#quote(OrderRequest)` → `PricingService#calculateTotal(Order)` (modified) çağırıyor.
- `com.acme.shop.adapter.in.web.OrderController#placeOrder(OrderRequest)` → `PlaceOrderUseCase#placeOrder(PlaceOrderCommand)` üzerinden
  değişen `PlaceOrderService#placeOrder(PlaceOrderCommand)` (güven: `likely`).
- `com.acme.shop.adapter.in.web.OrderController#cancel(String)` → `CancelOrderUseCase#cancelOrder(String)` üzerinden değişen
  `CancelOrderService#cancelOrder(String)` (güven: `likely`).
- `com.acme.shop.adapter.out.payment.PaymentReference#next(String)` → silinen `StringUtils#legacyPad(String,int)` çağırıyor (kırık çağrı).
- `com.acme.shop.adapter.out.notification.EmailNotifier`, `...SmsNotifier`, `...PushNotifier`: `AbstractNotifier#notify(Order)` değişti,
  bu tipler onu kalıtımla kullanıyor (`extends` kenarı). Tipler başka nedenle de diff'te olduğu için düğüm durumu `modified` olabilir;
  ancak `AbstractNotifier` → alt tip `extends` kenarları grafikte bulunmalı.
- Test (diff dışı): `com.acme.shop.domain.service.PricingServiceTest` metotları (`calculateTotal` çağıranları) — test olarak işaretlenmeli.

Diff dışı etkilenmemesi gerekenler (yanlış pozitif kontrolü): `com.acme.shop.config.BeanConfig` üyeleri yalnızca yapıcı çağırır
(`PlaceOrderService`, `CancelOrderService`, `EmailNotifier`, `StripePaymentAdapter`, `PaypalPaymentAdapter` yapıcıları değişmedi);
`impacted` sayılmaları gerekmez.

---

## 4. Risk nedenleri (en az)

Kodlar öneridir; A2 farklı kod kullanabilir ama aynı nedeni Türkçe mesajla vermelidir.

| Sembol | Beklenen neden | Seviye (en az) |
| --- | --- | --- |
| `StringUtils#legacyPad(String,int)` | silinmiş, head'de çağıranı var (`removed-with-callers`) | critical |
| `PaymentGateway#charge(Money,String)` | public port/arayüz imza değişikliği, 2 implementasyon (`public-api-signature`) | high |
| `Money#equals(Object)`, `Money#hashCode()` | equals/hashCode değişti (`equals-hashcode`) | high |
| `OrderPersistenceAdapter#findById(String)` | boş catch bloğu (`empty-catch`) | medium |
| `CancelOrderService#cancelOrder(String)` | `@Transactional` eklendi (`transactional-change`), testi yok | medium |
| `OrderJpaRepository#findLargeOrdersByStatus(String,BigDecimal)` | `@Query` ile SQL/JPQL (`sql-string`) | medium |
| `AbstractNotifier#notify(Order)` | template method gövdesi değişti, 3 alt sınıf etkilenir; `printStackTrace`; testi yok | high |
| `AbstractNotifier#channelName()` | base sınıfa yeni abstract metot (tüm alt sınıflar implemente etmek zorunda) | medium |
| `PricingService#calculateTotal(Order)` | diff dışı çağıran var, test güncellenmedi | medium |
| `Order#totalAmount()` | public metot yeniden adlandırıldı | medium |
| `OrderController#placeOrderService` | `@Autowired` alan enjeksiyonu + mimari ihlal | medium |
| `src/main/resources/application.yml` | `ddl-auto: update` | medium |
| `P/util/ReportGenerator.java` | yok (kozmetik) | low |

---

## 5. Test uyarıları

- **Test güncellenmemiş:** `com.acme.shop.domain.service.PricingService` değişti (`calculateTotal` davranışı), `T/domain/service/PricingServiceTest.java` değişmedi.
- **Test güncellenmemiş:** `com.acme.shop.domain.model.Money` değişti (`equals`/`hashCode`), `T/domain/model/MoneyTest.java` değişmedi
  (`MoneyTest#shouldNotBeEqual_whenCurrencyDiffers()` artık başarısız olur).
- **Hiç testi yok** (değişen üretim tipleri; `relatedTestFiles` boş olmalı):
  `com.acme.shop.application.service.CancelOrderService`, `com.acme.shop.adapter.out.notification.AbstractNotifier`,
  `...EmailNotifier`, `...SmsNotifier`, `...PushNotifier`, `com.acme.shop.adapter.out.payment.StripePaymentAdapter`,
  `...PaypalPaymentAdapter`, `com.acme.shop.adapter.out.persistence.OrderPersistenceAdapter`, `...OrderJpaRepository`, `...OrderMapper`.
  `summary.untestedChanges` ≥ 10.
- **Testi var ve güncellenmiş:** `Order` (`OrderTest`), `PlaceOrderService` (`PlaceOrderServiceTest`), `OrderController` (`OrderControllerTest`, yalnızca import).
- **Yeni sınıf + yeni test:** `com.acme.shop.domain.service.OrderValidator` ↔ `T/domain/service/OrderValidatorTest.java` (eşleşmeli, uyarı yok).
- Bilgi: `OrderControllerTest` (`@WebMvcTest`) yeni `@Autowired PlaceOrderService` alanı için `@MockBean` eklemedi; test bağlamı açılmaz.
  Bu bir statik analiz beklentisi değildir, isteğe bağlı bulgudur.

---

## 6. `feature/small-fix`

- Tek dosya: `P/application/service/CancelOrderService.java` (modified, +3 satır, `cosmeticOnly` = false).
- `com.acme.shop.application.service.CancelOrderService#cancelOrder(String)`: **modified** (flags = [`body`]); karmaşıklık +1;
  `if (order.isCancelled()) { return; }` eklendi. Başka üye değişmez.
- Çağıran (diff dışı, `impacted`): `com.acme.shop.adapter.in.web.OrderController#cancel(String)` (`CancelOrderUseCase` üzerinden, `likely`).
- Test uyarısı: `CancelOrderService` için test yok.
- Mimari ihlal yok; risk seviyesi `low` veya `medium`.

### 6.1 Notlar / belirsizlikler
- Yalnızca anotasyon değişen üyenin durumu (`CancelOrderService#cancelOrder` @Transactional) sözleşmede kesin değil:
  `modified` beklenir, `signatureChanged` da kabul edilir; `annotations` bayrağı zorunludur.
- `StringUtils` hem kozmetik hem üye silme içerir (madde 7 ve 10 aynı dosyada); bu yüzden dosya kozmetik **değildir**.

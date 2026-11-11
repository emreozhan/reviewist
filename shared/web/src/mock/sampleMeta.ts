import type { ChangeGroup, Finding, ReviewStep } from '../../../src/shared/types';
import { lineOf } from './build';
import { GROUP, S, T } from './ids';
import { PATHS as P } from './samplePaths';

export function sampleGroups(): ChangeGroup[] {
  return [
    { id: GROUP.payment, title: 'PaymentGateway.charge imzası, 2 implementasyonu ve çağıranları', description: 'Port metodu idempotency anahtarı alacak şekilde değişti; dönüş tipi PaymentResult oldu ve checked PaymentException eklendi. Stripe ve Iyzico implementasyonları ile PlaceOrderService uyarlandı; RefundService (diff dışı) uyarlanmadı.', symbolIds: [S.pgCharge, S.stripeCharge, S.iyzCharge, S.posPlace, S.prSuccess, S.prFailure, T.PR, T.PE, S.testPlaces, S.testRejects, S.refCompensate], fileIds: [P.paymentGateway, P.paymentResult, P.paymentException, P.stripe, P.iyzico, P.placeOrder, P.placeOrderTest], riskLevel: 'critical' },
    { id: GROUP.notifier, title: 'AbstractNotifier.notify şablon metodu → 3 alt sınıf', description: 'Şablon metot artık supports() kancasına bakıyor ve gönderim hatalarını yutuyor. EmailNotifier, SmsNotifier ve PushNotifier değişmedi ama davranışları değişti.', symbolIds: [S.anNotify, S.anSupports, S.anSend, S.anFormat, T.EMAIL, T.SMS, T.PUSH, S.oelOn], fileIds: [P.notifier], riskLevel: 'high' },
    { id: GROUP.money, title: 'Money.equals eşitlik anlamı', description: 'equals para birimini karşılaştırmayı bıraktı; hashCode değişmedi.', symbolIds: [S.moneyEquals, S.moneyHash, T.MT], fileIds: [P.money], riskLevel: 'critical' },
    { id: GROUP.util, title: 'StringUtils temizliği ve legacyPad silinmesi', description: 'Biçim düzenlemeleri, isBlank davranış farkı ve diff dışında hâlâ çağrılan legacyPad\'in silinmesi.', symbolIds: [S.suLegacyPad, S.suIsBlank, S.suTruncate, S.invPrint, T.LMF], fileIds: [P.stringUtils, P.legacyFormatter], riskLevel: 'critical' },
    { id: GROUP.total, title: 'Order.getTotal → totalAmount yeniden adlandırma', description: 'Ad değişti, gövde aynı; diff içindeki 2 çağıran güncellendi.', symbolIds: [S.orderTotal, S.posPlace, S.ocCreate], fileIds: [P.order, P.orderController], riskLevel: 'medium' },
    { id: GROUP.tx, title: 'CancelOrderService.cancel işlem sınırı', description: '@Transactional eklendi; işlem içinde uzak iade çağrısı yapılıyor.', symbolIds: [S.cosCancel], fileIds: [P.cancelOrder], riskLevel: 'medium' },
    { id: GROUP.validator, title: 'validate: PlaceOrderService → OrderValidator', description: 'Metot birebir taşındı, görünürlüğü public oldu; kurucu yeni bağımlılığı alıyor.', symbolIds: [S.posValidate, S.ovValidate, S.posCtor, `${T.POS}#validator`, `${T.POST}#service`], fileIds: [P.orderValidator, P.placeOrder], riskLevel: 'low' },
    { id: GROUP.config, title: 'Yapı ve yapılandırma', description: 'stripe-java major yükseltmesi, Flyway eklenmesi, yeni migration ve zaman aşımı değişikliği.', symbolIds: [], fileIds: [P.pom, P.appYml, P.migration, P.messages], riskLevel: 'medium' },
    { id: GROUP.cosmetic, title: 'Kozmetik değişiklikler', description: 'Yalnızca import sırası ve biçim; güvenle atlanabilir.', symbolIds: [`${T.RG}#dailyReport(LocalDate,List<Order>)`, `${T.RG}#count(List<Order>)`], fileIds: [P.reportGenerator], riskLevel: 'low' },
  ];
}

export function samplePlan(): ReviewStep[] {
  const steps: Array<[string, string[], string]> = [
    [P.paymentGateway, [S.pgCharge], 'Sözleşme önce: port arayüzünün imzası değişti; 2 implementasyonu ve 4 çağıranı etkiliyor (1\'i diff dışında).'],
    [P.paymentResult, [S.prSuccess, S.prFailure], 'Yeni dönüş tipi: charge\'ın yeni sözleşmesini anlamak için.'],
    [P.paymentException, [], 'Yeni checked exception: çağıranların hata yönetimini belirler.'],
    [P.stripe, [S.stripeCharge], 'İmplementasyon 1/2: hata eşlemesi ve idempotency anahtarı.'],
    [P.iyzico, [S.iyzCharge], 'İmplementasyon 2/2: testi yok, daha dikkatli bak.'],
    [P.placeOrder, [S.posPlace, S.posCtor, S.posValidate], 'Ana çağıran: tahsilat akışı, işlem sınırı ve taşınan doğrulama.'],
    [P.orderValidator, [S.ovValidate], 'Taşınan validate: gövdenin aynı kaldığını doğrula.'],
    [P.money, [S.moneyEquals], 'Değer nesnesinin eşitlik anlamı değişti; hashCode ile tutarsız.'],
    [P.notifier, [S.anNotify, S.anSupports], 'Şablon metot: 3 alt sınıf (diff dışı) bu davranışı devralıyor.'],
    [P.stringUtils, [S.suLegacyPad, S.suIsBlank], 'legacyPad silindi ama diff dışında çağrılıyor.'],
    [P.order, [S.orderTotal, `${T.ORDER}#Order(UUID,String)`], 'Yeniden adlandırma ve domain\'e giren Spring bağımlılığı.'],
    [P.orderController, [S.ocCreate], 'Yeniden adlandırmayı izleyen tek satır.'],
    [P.cancelOrder, [S.cosCancel], 'İşlem sınırı değişikliği: uzak çağrı işlem içinde.'],
    [P.placeOrderTest, [S.testPlaces, S.testRejects], 'Testler yeni imzayı kapsıyor mu?'],
    [P.migration, [], 'Benzersiz indeks: mevcut veride çakışma olabilir mi?'],
    [P.pom, [], 'Bağımlılık değişiklikleri: stripe-java major sürüm.'],
    [P.appYml, [], 'Yapılandırma: zaman aşımı ve idempotency TTL.'],
    [P.legacyFormatter, [S.lmfFormat], 'Silinen kullanılmayan sınıf: çağıran yok.'],
    [P.messages, [], 'Yeniden adlandırılan mesaj dosyası.'],
    [P.reportGenerator, [], 'Yalnızca biçim: atlanabilir.'],
  ];
  return steps.map(([fileId, symbolIds, reason], i) => ({ order: i + 1, fileId, symbolIds, reason }));
}

export function sampleFindings(): Finding[] {
  return [
    { id: 'f-legacy-pad', severity: 'error', category: 'callers', title: 'Silinen StringUtils.legacyPad hâlâ çağrılıyor', message: `InvoicePrinter.print (InvoicePrinter.java:${lineOf(P.invoicePrinter, 'new', 'StringUtils.legacyPad(')}) diff dışında bu metodu çağırıyor; derleme kırılacak. Çağıranı güncelleyin ya da metodu geri getirin.`, file: P.stringUtils, symbolIds: [S.suLegacyPad, S.invPrint] },
    { id: 'f-refund-charge', severity: 'error', category: 'callers', title: 'RefundService.compensate eski charge imzasını kullanıyor', message: 'Diff dışındaki RefundService.compensate hâlâ charge(Money, String) çağırıyor ve boolean bekliyor. Yeni imzayla derlenmez.', file: P.paymentGateway, line: lineOf(P.paymentGateway, 'new', 'PaymentResult charge('), symbolIds: [S.pgCharge, S.refCompensate] },
    { id: 'f-money-equals', severity: 'error', category: 'risk', title: 'Money.equals ile hashCode tutarsız', message: 'equals artık para birimini karşılaştırmıyor ama hashCode hâlâ currency kullanıyor. Eşit nesneler farklı hash üretebilir; HashMap/HashSet davranışı bozulur. 10 TRY ile 10 USD eşit sayılıyor.', file: P.money, line: lineOf(P.money, 'new', 'value.compareTo(other.value)'), symbolIds: [S.moneyEquals, S.moneyHash] },
    { id: 'f-arch-spring', severity: 'warning', category: 'architecture', title: 'Domain katmanında Spring bağımlılığı', message: 'Order (domain) org.springframework.util.Assert import ediyor. Hexagonal mimaride domain framework\'ten bağımsız olmalı; Objects.requireNonNull veya kendi doğrulamanızı kullanın.', file: P.order, line: lineOf(P.order, 'new', 'import org.springframework.util.Assert;'), symbolIds: [`${T.ORDER}#Order(UUID,String)`] },
    { id: 'f-template', severity: 'warning', category: 'inheritance', title: 'Şablon metot davranışı değişti: 3 alt sınıf etkileniyor', message: 'AbstractNotifier.notify artık supports() false ise erken dönüyor. EmailNotifier, SmsNotifier ve PushNotifier değişmedi ama bildirim akışları değişti.', file: P.notifier, line: lineOf(P.notifier, 'new', 'if (!supports(event))'), symbolIds: [S.anNotify, T.EMAIL, T.SMS, T.PUSH] },
    { id: 'f-swallow', severity: 'warning', category: 'risk', title: 'Bildirim hataları yutuluyor', message: 'send() içindeki RuntimeException yakalanıp yalnızca loglanıyor; OrderEventListener artık başarısız bildirimleri fark edemez.', file: P.notifier, line: lineOf(P.notifier, 'new', 'catch (RuntimeException e)'), symbolIds: [S.anNotify] },
    { id: 'f-tx-place', severity: 'warning', category: 'risk', title: 'Ödeme çağrısı işlem içinde', message: 'PlaceOrderService.place @Transactional; charge uzak çağrısı işlem içinde yapılıyor. Kayıt başarısız olursa tahsilat geri alınmaz (idempotency anahtarı tekrar denemeyi korur ama iade etmez).', file: P.placeOrder, line: lineOf(P.placeOrder, 'new', 'payments.charge('), symbolIds: [S.posPlace] },
    { id: 'f-tx-cancel', severity: 'warning', category: 'risk', title: '@Transactional içinde uzak iade çağrısı', message: 'CancelOrderService.cancel artık işlem içinde; payments.refund başarılı olup commit başarısız olursa para iade edilmiş ama sipariş iptal edilmemiş olur.', file: P.cancelOrder, line: lineOf(P.cancelOrder, 'new', 'payments.refund('), symbolIds: [S.cosCancel] },
    { id: 'f-money-test', severity: 'warning', category: 'test', title: 'Money.equals değişti ama MoneyTest güncellenmedi', message: 'MoneyTest eşitlik davranışını test etmiyor. Farklı para birimi ve ölçek senaryoları için test ekleyin.', file: P.money, line: lineOf(P.money, 'new', 'public boolean equals('), symbolIds: [S.moneyEquals] },
    { id: 'f-notifier-test', severity: 'warning', category: 'test', title: 'AbstractNotifier hiyerarşisi için test yok', message: 'Şablon metot ve 3 alt sınıf için hiçbir test bulunamadı.', file: P.notifier, symbolIds: [S.anNotify] },
    { id: 'f-stripe-major', severity: 'warning', category: 'risk', title: 'stripe-java major sürüm yükseltmesi (24 → 26)', message: 'Major sürüm geçişi API kırılmaları içerebilir; değişiklik notlarını kontrol edin.', file: P.pom, line: lineOf(P.pom, 'new', '<stripe.version>') },
    { id: 'f-iyzico-test', severity: 'info', category: 'test', title: 'IyzicoPaymentGateway için test yok', message: 'İmza değişikliği testsiz bir implementasyonu etkiliyor.', file: P.iyzico, symbolIds: [S.iyzCharge] },
    { id: 'f-api-charge', severity: 'info', category: 'api', title: 'Public port imzası değişti: PaymentGateway.charge', message: 'Parametre eklendi, dönüş tipi ve throws değişti. Tüm implementasyonlar ve çağıranlar uyarlanmalı.', file: P.paymentGateway, line: lineOf(P.paymentGateway, 'new', 'PaymentResult charge('), symbolIds: [S.pgCharge] },
    { id: 'f-iyzico-throws', severity: 'info', category: 'api', title: 'charge PaymentException bildiriyor ama fırlatmıyor', message: 'IyzicoPaymentGateway.charge gövdesinde PaymentException fırlatılmıyor; sağlayıcı hataları RuntimeException olarak sızabilir.', file: P.iyzico, line: lineOf(P.iyzico, 'new', 'public PaymentResult charge('), symbolIds: [S.iyzCharge] },
    { id: 'f-migration', severity: 'info', category: 'other', title: 'Yeni benzersiz indeks', message: 'ux_orders_payment_tx benzersiz; NULL değerler çakışmaz ama veri taşıması gerekiyorsa kontrol edin.', file: P.migration, line: 2 },
    { id: 'f-timeout', severity: 'info', category: 'other', title: 'Stripe zaman aşımı 10s → 30s', message: 'İşlem içindeki uzak çağrıyla birlikte bağlantı havuzunu daha uzun tutabilir.', file: P.appYml, line: lineOf(P.appYml, 'new', 'timeout: 30s') },
    { id: 'f-moved', severity: 'info', category: 'other', title: 'validate birebir taşındı', message: 'PlaceOrderService.validate → OrderValidator.validate; gövde aynı, görünürlük public oldu.', file: P.orderValidator, line: lineOf(P.orderValidator, 'new', 'public void validate('), symbolIds: [S.ovValidate, S.posValidate] },
    { id: 'f-isblank', severity: 'info', category: 'risk', title: 'StringUtils.isBlank ince davranış farkı', message: 'String.isBlank Unicode boşluklarını da boş sayar; trim().isEmpty() saymıyordu.', file: P.stringUtils, line: lineOf(P.stringUtils, 'new', 's.isBlank()'), symbolIds: [S.suIsBlank] },
    { id: 'f-cosmetic', severity: 'info', category: 'cosmetic', title: 'ReportGenerator yalnızca biçim değişikliği içeriyor', message: 'Import sırası ve satır bölme; davranış değişikliği yok.', file: P.reportGenerator },
  ];
}

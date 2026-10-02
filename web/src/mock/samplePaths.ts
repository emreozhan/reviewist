const M = 'src/main/java/com/shop/';
const T = 'src/test/java/com/shop/';

/** Örnek "shop" projesindeki dosya yolları (mock). */
export const PATHS = {
  paymentGateway: `${M}domain/payment/PaymentGateway.java`,
  paymentResult: `${M}domain/payment/PaymentResult.java`,
  paymentException: `${M}domain/payment/PaymentException.java`,
  stripe: `${M}adapter/out/payment/StripePaymentGateway.java`,
  iyzico: `${M}adapter/out/payment/IyzicoPaymentGateway.java`,
  placeOrder: `${M}application/PlaceOrderService.java`,
  orderValidator: `${M}application/OrderValidator.java`,
  order: `${M}domain/order/Order.java`,
  money: `${M}domain/money/Money.java`,
  notifier: `${M}application/notification/AbstractNotifier.java`,
  cancelOrder: `${M}application/CancelOrderService.java`,
  stringUtils: `${M}util/StringUtils.java`,
  legacyFormatter: `${M}util/LegacyMoneyFormatter.java`,
  reportGenerator: `${M}adapter/out/report/ReportGenerator.java`,
  orderController: `${M}adapter/in/web/OrderController.java`,
  placeOrderTest: `${T}application/PlaceOrderServiceTest.java`,
  pom: 'pom.xml',
  appYml: 'src/main/resources/application.yml',
  migration: 'src/main/resources/db/migration/V7__payment_idempotency.sql',
  messagesOld: 'src/main/resources/messages.properties',
  messages: 'src/main/resources/i18n/messages_tr.properties',
  // Diff dışında kalan (yalnız head içeriği olan) dosyalar
  emailNotifier: `${M}adapter/out/notification/EmailNotifier.java`,
  smsNotifier: `${M}adapter/out/notification/SmsNotifier.java`,
  pushNotifier: `${M}adapter/out/notification/PushNotifier.java`,
  eventListener: `${M}application/notification/OrderEventListener.java`,
  invoicePrinter: `${M}adapter/out/report/InvoicePrinter.java`,
  refundService: `${M}application/RefundService.java`,
  moneyTest: `${T}domain/money/MoneyTest.java`,
} as const;

import { PATHS } from './samplePaths';
import * as pay from './sourcesPayment';
import * as dom from './sourcesDomain';
import * as oth from './sourcesOther';
import * as out from './sourcesOutside';

export interface SampleFile {
  old: string | null;
  new: string | null;
}

/** `/api/reviews/:id/file` mock'u için eski/yeni dosya içerikleri. Anahtar: dosya yolu. */
export const sampleFiles: Record<string, SampleFile> = {
  [PATHS.paymentGateway]: { old: pay.paymentGatewayOld, new: pay.paymentGatewayNew },
  [PATHS.paymentResult]: { old: null, new: pay.paymentResultNew },
  [PATHS.paymentException]: { old: null, new: pay.paymentExceptionNew },
  [PATHS.stripe]: { old: pay.stripeOld, new: pay.stripeNew },
  [PATHS.iyzico]: { old: pay.iyzicoOld, new: pay.iyzicoNew },
  [PATHS.placeOrder]: { old: pay.placeOrderOld, new: pay.placeOrderNew },
  [PATHS.orderValidator]: { old: null, new: pay.orderValidatorNew },
  [PATHS.placeOrderTest]: { old: pay.placeOrderTestOld, new: pay.placeOrderTestNew },
  [PATHS.order]: { old: dom.orderOld, new: dom.orderNew },
  [PATHS.money]: { old: dom.moneyOld, new: dom.moneyNew },
  [PATHS.notifier]: { old: dom.notifierOld, new: dom.notifierNew },
  [PATHS.cancelOrder]: { old: dom.cancelOrderOld, new: dom.cancelOrderNew },
  [PATHS.orderController]: { old: dom.orderControllerOld, new: dom.orderControllerNew },
  [PATHS.stringUtils]: { old: oth.stringUtilsOld, new: oth.stringUtilsNew },
  [PATHS.legacyFormatter]: { old: oth.legacyFormatterOld, new: null },
  [PATHS.reportGenerator]: { old: oth.reportGeneratorOld, new: oth.reportGeneratorNew },
  [PATHS.pom]: { old: oth.pomOld, new: oth.pomNew },
  [PATHS.appYml]: { old: oth.appYmlOld, new: oth.appYmlNew },
  [PATHS.migration]: { old: null, new: oth.migrationNew },
  [PATHS.messages]: { old: oth.messagesOld, new: oth.messagesNew },
  [PATHS.emailNotifier]: { old: out.emailNotifierNew, new: out.emailNotifierNew },
  [PATHS.smsNotifier]: { old: out.smsNotifierNew, new: out.smsNotifierNew },
  [PATHS.pushNotifier]: { old: out.pushNotifierNew, new: out.pushNotifierNew },
  [PATHS.eventListener]: { old: out.eventListenerNew, new: out.eventListenerNew },
  [PATHS.invoicePrinter]: { old: out.invoicePrinterNew, new: out.invoicePrinterNew },
  [PATHS.refundService]: { old: out.refundServiceNew, new: out.refundServiceNew },
  [PATHS.moneyTest]: { old: out.moneyTestNew, new: out.moneyTestNew },
};

/** Yeniden adlandırılan dosyalarda eski yol da aynı içeriğe işaret eder. */
sampleFiles[PATHS.messagesOld] = { old: oth.messagesOld, new: null };

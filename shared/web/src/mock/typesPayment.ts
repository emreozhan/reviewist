import type { TypeChange } from '../../../src/shared/types';
import { call, risk, type } from './build';
import { GROUP, S, T } from './ids';
import { PATHS as P } from './samplePaths';

const chargeCallers = () => [
  call(S.posPlace, P.placeOrder, 'payments.charge(', true),
  call(S.testPlaces, P.placeOrderTest, 'PaymentResult.success("tx-1")', true),
  call(S.testRejects, P.placeOrderTest, 'PaymentResult.failure("insufficient_funds")', true),
  call(S.refCompensate, P.refundService, 'payments.charge(', false, 'likely'),
];

export function paymentTypes(): TypeChange[] {
  return [
    type({
      id: T.PG, kind: 'interface', file: P.paymentGateway, status: 'signatureChanged', layer: 'port',
      subTypes: [T.STRIPE, T.IYZ], oldNeedle: 'public interface PaymentGateway', newNeedle: 'public interface PaymentGateway',
      details: ['Port sözleşmesi değişti: charge imzası', 'javadoc güncellendi'],
      risk: risk(['public-api-signature', 'Public arayüz metodunun imzası değişti', 35], ['implementations', '2 implementasyon etkileniyor', 15], ['outside-callers', 'Diff dışında eski imzayı kullanan 1 çağıran var', 25]),
      members: [
        {
          name: 'charge', params: 'Money,String,String', status: 'signatureChanged', groupId: GROUP.payment,
          oldId: S.pgChargeOld,
          signature: 'PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException',
          oldSignature: 'boolean charge(Money amount, String customerId)',
          flags: ['params', 'returnType', 'throws', 'javadoc'],
          details: ['parametre eklendi: String idempotencyKey', 'dönüş tipi boolean → PaymentResult', 'throws PaymentException eklendi (checked)', 'javadoc güncellendi'],
          oldNeedle: 'boolean charge(', newNeedle: 'PaymentResult charge(',
          overriddenBy: [S.stripeCharge, S.iyzCharge],
          callers: chargeCallers(),
          risk: risk(['public-api-signature', 'Public arayüz metodunun imzası değişti', 35], ['checked-exception', 'Yeni checked exception tüm çağıranları etkiler', 15], ['outside-callers', 'RefundService.compensate hâlâ 2 parametreli çağrı yapıyor', 30]),
        },
        { name: 'refund', params: 'String', status: 'unchanged', signature: 'void refund(String transactionId)', oldNeedle: 'void refund(', newNeedle: 'void refund(' },
      ],
    }),
    type({
      id: T.PR, kind: 'record', file: P.paymentResult, status: 'added', layer: 'domain', newNeedle: 'public record PaymentResult',
      details: ['yeni record: transactionId, approved, failureReason'],
      risk: risk(['new-type', 'Yeni domain tipi', 5]),
      members: [
        { name: 'success', params: 'String', status: 'added', signature: 'public static PaymentResult success(String transactionId)', newNeedle: 'public static PaymentResult success(', groupId: GROUP.payment,
          callers: [call(S.stripeCharge, P.stripe, 'PaymentResult.success(', true), call(S.iyzCharge, P.iyzico, 'PaymentResult.success(', true)] },
        { name: 'failure', params: 'String', status: 'added', signature: 'public static PaymentResult failure(String reason)', newNeedle: 'public static PaymentResult failure(', groupId: GROUP.payment,
          callers: [call(S.stripeCharge, P.stripe, 'PaymentResult.failure(charge', true), call(S.iyzCharge, P.iyzico, 'PaymentResult.failure(', true)] },
      ],
    }),
    type({
      id: T.PE, kind: 'class', file: P.paymentException, status: 'added', layer: 'domain', superTypes: ['java.lang.Exception'],
      newNeedle: 'public class PaymentException', details: ['yeni checked exception'],
      risk: risk(['new-type', 'Yeni checked exception tipi', 8]),
      members: [
        { name: 'providerCode', kind: 'field', status: 'added', visibility: 'private', signature: 'private final String providerCode', newNeedle: 'private final String providerCode;' },
        { name: 'PaymentException', kind: 'constructor', params: 'String,String', status: 'added', signature: 'public PaymentException(String message, String providerCode)', newNeedle: 'public PaymentException(' },
        { name: 'getProviderCode', params: '', status: 'added', signature: 'public String getProviderCode()', newNeedle: 'public String getProviderCode()' },
      ],
    }),
    type({
      id: T.STRIPE, kind: 'class', file: P.stripe, status: 'signatureChanged', layer: 'adapter-out', annotations: ['@Component'],
      superTypes: [T.PG], oldNeedle: 'public class StripePaymentGateway', newNeedle: 'public class StripePaymentGateway',
      details: ['charge yeni port imzasına uyarlandı', '4 import eklendi'],
      risk: risk(['implementation-change', 'Port implementasyonunun davranışı değişti', 25], ['error-handling', 'Hata yönetimi değişti: StripeException artık fırlatılıyor', 20]),
      members: [
        { name: 'clients', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final StripeClientFactory clients', oldNeedle: 'private final StripeClientFactory', newNeedle: 'private final StripeClientFactory' },
        { name: 'StripePaymentGateway', kind: 'constructor', params: 'StripeClientFactory', status: 'unchanged', signature: 'public StripePaymentGateway(StripeClientFactory clients)', oldNeedle: 'public StripePaymentGateway(', newNeedle: 'public StripePaymentGateway(' },
        {
          name: 'charge', params: 'Money,String,String', status: 'signatureChanged', groupId: GROUP.payment, oldId: `${T.STRIPE}#charge(Money,String)`,
          signature: 'public PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException',
          oldSignature: 'public boolean charge(Money amount, String customerId)',
          flags: ['params', 'returnType', 'throws', 'body'],
          details: ['parametre eklendi: String idempotencyKey', 'dönüş tipi boolean → PaymentResult', 'throws PaymentException eklendi', 'idempotency anahtarı RequestOptions ile Stripe\'a iletiliyor', 'CardException → PaymentResult.failure; diğer StripeException → PaymentException'],
          oldNeedle: 'public boolean charge(', newNeedle: 'public PaymentResult charge(',
          overrides: [S.pgCharge], callees: [S.prSuccess, S.prFailure],
          risk: risk(['signature-follow', 'Port imzasını izleyen değişiklik', 15], ['error-handling', 'Önceden yutulan hata artık fırlatılıyor', 25], ['no-test-update', 'StripePaymentGatewayTest güncellenmedi', 10]),
        },
        { name: 'refund', params: 'String', status: 'unchanged', signature: 'public void refund(String transactionId)', oldNeedle: 'public void refund(', newNeedle: 'public void refund(', overrides: [`${T.PG}#refund(String)`] },
      ],
    }),
    type({
      id: T.IYZ, kind: 'class', file: P.iyzico, status: 'signatureChanged', layer: 'adapter-out',
      superTypes: [T.PG], oldNeedle: 'public class IyzicoPaymentGateway', newNeedle: 'public class IyzicoPaymentGateway',
      details: ['charge yeni port imzasına uyarlandı'],
      risk: risk(['implementation-change', 'Port implementasyonunun davranışı değişti', 20], ['untested', 'Bu sınıf için test bulunamadı', 15]),
      members: [
        { name: 'options', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final Options options', oldNeedle: 'private final Options options;', newNeedle: 'private final Options options;' },
        { name: 'IyzicoPaymentGateway', kind: 'constructor', params: 'Options', status: 'unchanged', signature: 'public IyzicoPaymentGateway(Options options)', oldNeedle: 'public IyzicoPaymentGateway(', newNeedle: 'public IyzicoPaymentGateway(' },
        {
          name: 'charge', params: 'Money,String,String', status: 'signatureChanged', groupId: GROUP.payment, oldId: `${T.IYZ}#charge(Money,String)`,
          signature: 'public PaymentResult charge(Money amount, String customerId, String idempotencyKey) throws PaymentException',
          oldSignature: 'public boolean charge(Money amount, String customerId)',
          flags: ['params', 'returnType', 'throws', 'body'],
          details: ['parametre eklendi: String idempotencyKey', 'dönüş tipi boolean → PaymentResult', 'idempotencyKey conversationId olarak gönderiliyor', 'throws PaymentException bildiriliyor ama gövdede hiç fırlatılmıyor'],
          oldNeedle: 'public boolean charge(', newNeedle: 'public PaymentResult charge(',
          overrides: [S.pgCharge], callees: [S.prSuccess, S.prFailure],
          risk: risk(['signature-follow', 'Port imzasını izleyen değişiklik', 15], ['untested', 'İlgili test yok', 20]),
        },
        { name: 'refund', params: 'String', status: 'unchanged', signature: 'public void refund(String transactionId)', oldNeedle: 'public void refund(', newNeedle: 'public void refund(', overrides: [`${T.PG}#refund(String)`] },
      ],
    }),
  ];
}

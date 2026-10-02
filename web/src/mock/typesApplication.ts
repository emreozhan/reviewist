import type { TypeChange } from '../../../src/shared/types';
import { call, risk, type } from './build';
import { GROUP, S, T } from './ids';
import { PATHS as P } from './samplePaths';

export function applicationTypes(): TypeChange[] {
  return [
    type({
      id: T.POS, kind: 'class', file: P.placeOrder, status: 'modified', layer: 'application', annotations: ['@Service'],
      oldNeedle: 'public class PlaceOrderService', newNeedle: 'public class PlaceOrderService',
      details: ['OrderValidator bağımlılığı eklendi', 'validate metodu OrderValidator\'a taşındı', 'charge yeni imzayla çağrılıyor'],
      risk: risk(['calls-changed-api', 'İmzası değişen port metodunu çağırıyor', 20], ['tx-remote-call', 'Uzak ödeme çağrısı @Transactional içinde', 20], ['constructor-change', 'Kurucu imzası değişti', 10]),
      members: [
        { name: 'orders', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final OrderRepository orders', oldNeedle: 'private final OrderRepository orders;', newNeedle: 'private final OrderRepository orders;' },
        { name: 'payments', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final PaymentGateway payments', oldNeedle: 'private final PaymentGateway payments;', newNeedle: 'private final PaymentGateway payments;' },
        { name: 'validator', kind: 'field', status: 'added', visibility: 'private', signature: 'private final OrderValidator validator', newNeedle: 'private final OrderValidator validator;', groupId: GROUP.validator },
        {
          name: 'PlaceOrderService', kind: 'constructor', params: 'OrderRepository,PaymentGateway,OrderValidator', status: 'signatureChanged',
          oldId: `${T.POS}#PlaceOrderService(OrderRepository,PaymentGateway)`,
          signature: 'public PlaceOrderService(OrderRepository orders, PaymentGateway payments, OrderValidator validator)',
          oldSignature: 'public PlaceOrderService(OrderRepository orders, PaymentGateway payments)',
          flags: ['params', 'body'], details: ['parametre eklendi: OrderValidator validator'],
          oldNeedle: 'public PlaceOrderService(', newNeedle: 'public PlaceOrderService(', groupId: GROUP.validator,
          callers: [call(`${T.POST}#service`, P.placeOrderTest, 'new PlaceOrderService(orders, payments, new OrderValidator())', true)],
          risk: risk(['constructor-change', 'Kurucu imzası değişti (Spring enjeksiyonu otomatik)', 10]),
        },
        {
          name: 'place', params: 'Order', status: 'modified', groupId: GROUP.payment,
          signature: 'public Order place(Order order)', flags: ['body'],
          details: ['validate(order) → validator.validate(order)', 'order.getTotal() → order.totalAmount()', 'charge yeni imzayla: idempotencyKey = order.id()', 'PaymentException → IllegalStateException olarak sarmalanıyor', 'reddedilen ödemede hata mesajı failureReason içeriyor'],
          oldNeedle: 'public Order place(', newNeedle: 'public Order place(',
          callers: [
            call(S.ocCreate, P.orderController, 'placeOrder.place(', true),
            call(S.testPlaces, P.placeOrderTest, 'assertThat(service.place(order)', true),
            call(S.testRejects, P.placeOrderTest, 'assertThatThrownBy(() -> service.place(order))', true),
          ],
          callees: [S.ovValidate, S.orderTotal, S.pgCharge],
          risk: risk(['calls-changed-api', 'İmzası değişen 2 sembolü çağırıyor', 20], ['tx-remote-call', 'Uzak ödeme çağrısı @Transactional içinde; geri alma tahsilatı geri almaz', 25], ['complexity', 'Yeni dallanmalar: try/catch + red kontrolü', 5]),
        },
        {
          name: 'validate', params: 'Order', status: 'moved', visibility: 'private', groupId: GROUP.validator,
          signature: 'private void validate(Order order)', flags: [],
          details: ['OrderValidator.validate metoduna taşındı', 'gövde birebir aynı'],
          oldNeedle: 'private void validate(',
          risk: risk(['moved', 'Taşınan metot: gövde aynı', 5]),
        },
      ],
    }),
    type({
      id: T.OV, kind: 'class', file: P.orderValidator, status: 'added', layer: 'application', annotations: ['@Component'],
      newNeedle: 'public class OrderValidator', details: ['yeni sınıf: PlaceOrderService.validate buraya taşındı'],
      risk: risk(['new-type', 'Yeni bileşen', 5], ['untested', 'Doğrudan testi yok', 10]),
      members: [
        {
          name: 'validate', params: 'Order', status: 'moved', oldId: S.posValidate, groupId: GROUP.validator,
          signature: 'public void validate(Order order)', oldSignature: 'private void validate(Order order)',
          flags: ['visibility'], details: ['PlaceOrderService.validate metodundan taşındı', 'görünürlük private → public', 'gövde birebir aynı'],
          newNeedle: 'public void validate(',
          callers: [call(S.posPlace, P.placeOrder, 'validator.validate(order)', true)],
          risk: risk(['moved', 'Taşınan metot: gövde aynı', 5], ['visibility', 'Görünürlük genişledi', 5]),
        },
      ],
    }),
    type({
      id: T.AN, kind: 'class', file: P.notifier, status: 'modified', layer: 'application',
      subTypes: [T.EMAIL, T.SMS, T.PUSH], oldNeedle: 'public abstract class AbstractNotifier', newNeedle: 'public abstract class AbstractNotifier',
      details: ['şablon metot notify değişti', 'yeni kanca: supports(OrderEvent)'],
      risk: risk(['template-method', 'Şablon metot davranışı değişti; 3 alt sınıfın akışı etkileniyor', 30], ['outside-impact', 'Diff dışında 3 alt sınıf ve 1 çağıran', 15], ['untested', 'Bu hiyerarşi için test yok', 15]),
      members: [
        { name: 'log', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private static final Logger log', oldNeedle: 'private static final Logger log', newNeedle: 'private static final Logger log' },
        {
          name: 'notify', params: 'OrderEvent', status: 'modified', groupId: GROUP.notifier,
          signature: 'public final void notify(OrderEvent event)', flags: ['body'],
          details: ['supports(event) false ise erken dönüyor', 'send() içindeki RuntimeException artık yutuluyor ve yalnızca loglanıyor', 'başarı logu kaldırıldı'],
          oldNeedle: 'public final void notify(', newNeedle: 'public final void notify(',
          callers: [call(S.oelOn, P.eventListener, 'notifier.notify(event)', false)],
          callees: [S.anSupports, S.anFormat, S.anSend],
          risk: risk(['template-method', 'Şablon metot: 3 alt sınıfın davranışı değişiyor', 30], ['swallowed-exception', 'Gönderim hataları artık çağırana ulaşmıyor', 25], ['untested', 'Test yok', 10]),
        },
        {
          name: 'supports', params: 'OrderEvent', status: 'added', visibility: 'protected', groupId: GROUP.notifier,
          signature: 'protected boolean supports(OrderEvent event)', details: ['yeni kanca metot; alt sınıflar override edebilir', 'boş alıcıda bildirim atlanıyor'],
          newNeedle: 'protected boolean supports(',
          callers: [call(S.anNotify, P.notifier, 'if (!supports(event))', true)],
          risk: risk(['new-hook', 'Yeni kanca metot', 10]),
        },
        { name: 'format', params: 'OrderEvent', status: 'unchanged', visibility: 'protected', signature: 'protected abstract String format(OrderEvent event)', oldNeedle: 'protected abstract String format(', newNeedle: 'protected abstract String format(', overriddenBy: [S.emailFormat, S.smsFormat, S.pushFormat] },
        { name: 'send', params: 'String,String', status: 'unchanged', visibility: 'protected', signature: 'protected abstract void send(String recipient, String message)', oldNeedle: 'protected abstract void send(', newNeedle: 'protected abstract void send(', overriddenBy: [S.emailSend, S.smsSend, S.pushSend] },
      ],
    }),
    type({
      id: T.COS, kind: 'class', file: P.cancelOrder, status: 'modified', layer: 'application', annotations: ['@Service'],
      oldNeedle: 'public class CancelOrderService', newNeedle: 'public class CancelOrderService',
      details: ['cancel metoduna @Transactional eklendi'],
      risk: risk(['transaction-boundary', 'İşlem sınırı değişti', 20], ['tx-remote-call', 'İşlem içinde uzak çağrı (refund)', 15], ['untested', 'Test yok', 10]),
      members: [
        { name: 'orders', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final OrderRepository orders', oldNeedle: 'private final OrderRepository orders;', newNeedle: 'private final OrderRepository orders;' },
        { name: 'payments', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final PaymentGateway payments', oldNeedle: 'private final PaymentGateway payments;', newNeedle: 'private final PaymentGateway payments;' },
        { name: 'CancelOrderService', kind: 'constructor', params: 'OrderRepository,PaymentGateway', status: 'unchanged', signature: 'public CancelOrderService(OrderRepository orders, PaymentGateway payments)', oldNeedle: 'public CancelOrderService(', newNeedle: 'public CancelOrderService(' },
        {
          name: 'cancel', params: 'UUID', status: 'modified', groupId: GROUP.tx, signature: '@Transactional public void cancel(UUID orderId)', oldSignature: 'public void cancel(UUID orderId)',
          flags: ['annotations'], details: ['@Transactional eklendi', 'işlem içinde uzak çağrı: payments.refund(...) — refund başarısız olursa iptal geri alınır, başarılı olup commit başarısız olursa para iade edilmiş ama sipariş iptal edilmemiş olur'],
          oldNeedle: 'public void cancel(', newNeedle: 'public void cancel(',
          callees: [`${T.ORDER}#cancel()`, `${T.PG}#refund(String)`],
          risk: risk(['transaction-boundary', 'İşlem sınırı değişti', 20], ['tx-remote-call', 'İşlem içinde uzak çağrı', 15], ['untested', 'Test yok', 10]),
        },
      ],
    }),
    type({
      id: T.OC, kind: 'class', file: P.orderController, status: 'modified', layer: 'adapter-in', annotations: ['@RestController'],
      oldNeedle: 'public class OrderController', newNeedle: 'public class OrderController', details: ['yeniden adlandırılan totalAmount() kullanımı'],
      risk: risk(['rename-follow', 'Yeniden adlandırmayı izleyen değişiklik', 5]),
      members: [
        { name: 'placeOrder', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final PlaceOrderService placeOrder', oldNeedle: 'private final PlaceOrderService placeOrder;', newNeedle: 'private final PlaceOrderService placeOrder;' },
        { name: 'mapper', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final OrderMapper mapper', oldNeedle: 'private final OrderMapper mapper;', newNeedle: 'private final OrderMapper mapper;' },
        { name: 'OrderController', kind: 'constructor', params: 'PlaceOrderService,OrderMapper', status: 'unchanged', signature: 'public OrderController(PlaceOrderService placeOrder, OrderMapper mapper)', oldNeedle: 'public OrderController(', newNeedle: 'public OrderController(' },
        {
          name: 'create', params: 'OrderRequest', status: 'modified', groupId: GROUP.total, signature: 'public OrderResponse create(OrderRequest request)', flags: ['body'],
          details: ['order.getTotal() → order.totalAmount()'], oldNeedle: 'public OrderResponse create(', newNeedle: 'public OrderResponse create(',
          callees: [S.posPlace, S.orderTotal], risk: risk(['rename-follow', 'Yeniden adlandırmayı izleyen değişiklik', 5]),
        },
      ],
    }),
    type({
      id: T.POST, kind: 'class', file: P.placeOrderTest, status: 'modified', layer: 'test', visibility: 'package',
      oldNeedle: 'class PlaceOrderServiceTest', newNeedle: 'class PlaceOrderServiceTest', details: ['yeni charge imzası ve OrderValidator için güncellendi'],
      members: [
        { name: 'orders', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final OrderRepository orders', oldNeedle: 'private final OrderRepository orders', newNeedle: 'private final OrderRepository orders' },
        { name: 'payments', kind: 'field', status: 'unchanged', visibility: 'private', signature: 'private final PaymentGateway payments', oldNeedle: 'private final PaymentGateway payments', newNeedle: 'private final PaymentGateway payments' },
        { name: 'service', kind: 'field', status: 'modified', visibility: 'private', signature: 'private final PlaceOrderService service', flags: ['initializer'], details: ['başlatıcıya new OrderValidator() eklendi'], oldNeedle: 'private final PlaceOrderService service', newNeedle: 'private final PlaceOrderService service', groupId: GROUP.validator },
        { name: 'placesPaidOrder', params: '', status: 'signatureChanged', visibility: 'package', signature: 'void placesPaidOrder() throws Exception', oldSignature: 'void placesPaidOrder()', flags: ['throws', 'body'], details: ['throws Exception eklendi', 'mock: charge(any(), anyString(), anyString()) → PaymentResult.success'], oldNeedle: 'void placesPaidOrder()', newNeedle: 'void placesPaidOrder()', groupId: GROUP.payment, callees: [S.pgCharge, S.posPlace] },
        { name: 'rejectsDeclinedPayment', params: '', status: 'renamed', visibility: 'package', oldName: 'rejectsFailedPayment', oldId: `${T.POST}#rejectsFailedPayment()`, signature: 'void rejectsDeclinedPayment() throws Exception', oldSignature: 'void rejectsFailedPayment()', flags: ['throws', 'body'], details: ['ad rejectsFailedPayment → rejectsDeclinedPayment', 'throws Exception eklendi', 'mock dönüşü false → PaymentResult.failure(...)'], oldNeedle: 'void rejectsFailedPayment()', newNeedle: 'void rejectsDeclinedPayment()', groupId: GROUP.payment, callees: [S.pgCharge, S.posPlace] },
      ],
    }),
  ];
}

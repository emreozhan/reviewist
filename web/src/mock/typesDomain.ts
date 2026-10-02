import type { TypeChange } from '../../../src/shared/types';
import type { MemberSpec } from './build';
import { call, risk, type } from './build';
import { GROUP, S, T } from './ids';
import { PATHS as P } from './samplePaths';

/** Her iki tarafta aynı iğneyle bulunan değişmemiş üye. */
function same(name: string, params: string | undefined, signature: string, needle: string, kind: MemberSpec['kind'] = 'method'): MemberSpec {
  const isField = kind === 'field';
  return {
    name, params, kind, signature, status: 'unchanged', oldNeedle: needle, newNeedle: needle,
    visibility: signature.startsWith('private') ? 'private' : 'public',
    ...(isField ? { params: undefined } : {}),
  };
}

export function domainTypes(): TypeChange[] {
  return [
    type({
      id: T.ORDER, kind: 'class', file: P.order, status: 'modified', layer: 'domain',
      oldNeedle: 'public class Order', newNeedle: 'public class Order',
      flags: ['annotations'], details: ['org.springframework.util.Assert import edildi (domain katmanında Spring bağımlılığı)', 'getTotal → totalAmount'],
      risk: risk(['architecture', 'Domain katmanı framework\'e bağımlı hale geldi', 25], ['public-api-rename', 'Public metot yeniden adlandırıldı', 15]),
      members: [
        same('id', undefined, 'private final UUID id', 'private final UUID id;', 'field'),
        same('customerId', undefined, 'private final String customerId', 'private final String customerId;', 'field'),
        same('lines', undefined, 'private final List<OrderLine> lines', 'private final List<OrderLine> lines', 'field'),
        same('status', undefined, 'private OrderStatus status', 'private OrderStatus status', 'field'),
        {
          name: 'Order', kind: 'constructor', params: 'UUID,String', status: 'modified', signature: 'public Order(UUID id, String customerId)', flags: ['body'],
          details: ['Assert.hasText(customerId) doğrulaması eklendi (Spring util)', 'boş customerId artık IllegalArgumentException fırlatıyor'],
          oldNeedle: 'public Order(UUID id', newNeedle: 'public Order(UUID id',
          risk: risk(['architecture', 'Domain sınıfında Spring sınıfı kullanılıyor', 25], ['behavior', 'Kurucu artık istisna fırlatabilir', 10]),
        },
        same('id', '', 'public UUID id()', 'public UUID id()'),
        same('customerId', '', 'public String customerId()', 'public String customerId()'),
        same('lines', '', 'public List<OrderLine> lines()', 'public List<OrderLine> lines()'),
        same('addLine', 'OrderLine', 'public void addLine(OrderLine line)', 'public void addLine('),
        {
          name: 'totalAmount', params: '', status: 'renamed', oldName: 'getTotal', oldId: S.orderGetTotal, groupId: GROUP.total,
          signature: 'public Money totalAmount()', oldSignature: 'public Money getTotal()', flags: [],
          details: ['ad getTotal → totalAmount', 'gövde aynı', 'diff içindeki 2 çağıran güncellendi'],
          oldNeedle: 'public Money getTotal()', newNeedle: 'public Money totalAmount()',
          callers: [call(S.posPlace, P.placeOrder, 'order.totalAmount()', true), call(S.ocCreate, P.orderController, 'order.totalAmount()', true)],
          risk: risk(['public-api-rename', 'Public metot yeniden adlandırıldı', 15], ['callers-updated', 'Bilinen tüm çağıranlar güncellenmiş', 5]),
        },
        same('markPaid', '', 'public void markPaid()', 'public void markPaid()'),
        same('cancel', '', 'public void cancel()', 'public void cancel()'),
        same('status', '', 'public OrderStatus status()', 'public OrderStatus status()'),
      ],
    }),
    type({
      id: T.MONEY, kind: 'class', file: P.money, status: 'modified', layer: 'domain',
      oldNeedle: 'public final class Money', newNeedle: 'public final class Money', details: ['equals semantiği değişti'],
      risk: risk(['equals-hashcode', 'equals ve hashCode tutarsız', 40], ['value-object', 'Değer nesnesinin eşitlik anlamı değişti', 25], ['no-test-update', 'MoneyTest güncellenmedi', 15]),
      members: [
        same('ZERO', undefined, 'public static final Money ZERO', 'public static final Money ZERO', 'field'),
        same('value', undefined, 'private final BigDecimal value', 'private final BigDecimal value;', 'field'),
        same('currency', undefined, 'private final Currency currency', 'private final Currency currency;', 'field'),
        { ...same('Money', 'BigDecimal,Currency', 'public Money(BigDecimal value, Currency currency)', 'public Money(BigDecimal'), kind: 'constructor' },
        same('value', '', 'public BigDecimal value()', 'public BigDecimal value()'),
        same('currency', '', 'public Currency currency()', 'public Currency currency()'),
        same('toMinorUnits', '', 'public long toMinorUnits()', 'public long toMinorUnits()'),
        same('plus', 'Money', 'public Money plus(Money other)', 'public Money plus('),
        same('negate', '', 'public Money negate()', 'public Money negate()'),
        {
          name: 'equals', params: 'Object', status: 'modified', groupId: GROUP.money, signature: 'public boolean equals(Object o)', flags: ['body'],
          details: ['para birimi artık karşılaştırılmıyor: 10 TRY == 10 USD', 'BigDecimal.equals → compareTo (ölçek farkı yok sayılıyor)', 'hashCode güncellenmedi: hâlâ currency içeriyor'],
          oldNeedle: 'public boolean equals(', newNeedle: 'public boolean equals(', overrides: ['java.lang.Object#equals(Object)'],
          risk: risk(['equals-hashcode', 'equals ve hashCode tutarsız: HashMap/HashSet davranışı bozulur', 40], ['value-object', 'Farklı para birimleri eşit sayılıyor', 25], ['no-test-update', 'MoneyTest güncellenmedi', 15]),
        },
        same('hashCode', '', 'public int hashCode()', 'public int hashCode()'),
      ],
    }),
    type({
      id: T.SU, kind: 'class', file: P.stringUtils, status: 'modified', layer: 'util',
      oldNeedle: 'public final class StringUtils', newNeedle: 'public final class StringUtils', details: ['legacyPad silindi', 'biçim düzenlemeleri'],
      risk: risk(['removed-with-callers', 'Silinen metot diff dışında hâlâ çağrılıyor', 60], ['public-api-removed', 'Public metot silindi', 20]),
      members: [
        { name: 'StringUtils', kind: 'constructor', params: '', status: 'cosmetic', visibility: 'private', signature: 'private StringUtils()', flags: ['formatting'], details: ['yalnızca biçim'], oldNeedle: 'private StringUtils()', newNeedle: 'private StringUtils()', groupId: GROUP.util },
        {
          name: 'isBlank', params: 'String', status: 'modified', signature: 'public static boolean isBlank(String s)', flags: ['body'], groupId: GROUP.util,
          details: ['s.trim().isEmpty() → s.isBlank()', 'Unicode boşluk karakterleri artık da boş sayılıyor'],
          oldNeedle: 'public static boolean isBlank(', newNeedle: 'public static boolean isBlank(',
          risk: risk(['subtle-behavior', 'İnce davranış farkı (Unicode boşluk)', 10]),
        },
        { name: 'truncate', params: 'String,int', status: 'cosmetic', signature: 'public static String truncate(String s, int max)', flags: ['formatting', 'javadoc'], details: ['javadoc eklendi', 'tek satırlık if süslü paranteze alındı'], oldNeedle: 'public static String truncate(', newNeedle: 'public static String truncate(', groupId: GROUP.util },
        {
          name: 'legacyPad', params: 'String,int', status: 'removed', signature: 'public static String legacyPad(String s, int width)', groupId: GROUP.util,
          details: ['@Deprecated metot silindi', 'diff dışında 1 çağıran hâlâ kullanıyor: InvoicePrinter.print'],
          oldNeedle: 'public static String legacyPad(',
          callers: [call(S.invPrint, P.invoicePrinter, 'StringUtils.legacyPad(', false)],
          risk: risk(['removed-with-callers', 'Silinen metot diff dışında hâlâ çağrılıyor (derleme kırılır)', 60], ['public-api-removed', 'Public metot silindi', 20]),
        },
      ],
    }),
    type({
      id: T.LMF, kind: 'class', file: P.legacyFormatter, status: 'removed', layer: 'util', annotations: ['@Deprecated'],
      oldNeedle: 'public class LegacyMoneyFormatter', details: ['kullanılmayan @Deprecated sınıf silindi; repo içinde çağıran bulunamadı'],
      risk: risk(['removed-type', 'Tip silindi (çağıran yok)', 10]),
      members: [
        { name: 'FORMAT', kind: 'field', status: 'removed', visibility: 'private', signature: 'private static final DecimalFormat FORMAT', oldNeedle: 'private static final DecimalFormat FORMAT' },
        { name: 'format', params: 'Money', status: 'removed', signature: 'public static String format(Money money)', oldNeedle: 'public static String format(' },
      ],
    }),
    type({
      id: T.RG, kind: 'class', file: P.reportGenerator, status: 'cosmetic', layer: 'adapter-out', flags: ['formatting'],
      oldNeedle: 'public class ReportGenerator', newNeedle: 'public class ReportGenerator', details: ['import sırası düzenlendi', 'stream zinciri satırlara bölündü'],
      members: [
        { name: 'dailyReport', params: 'LocalDate,List<Order>', status: 'cosmetic', signature: 'public String dailyReport(LocalDate day, List<Order> orders)', flags: ['formatting'], details: ['yalnızca satır bölme'], oldNeedle: 'public String dailyReport(', newNeedle: 'public String dailyReport(', groupId: GROUP.cosmetic },
        { name: 'count', params: 'List<Order>', status: 'cosmetic', signature: 'public int count(List<Order> orders)', flags: ['formatting'], details: ['süslü parantez öncesi boşluk'], oldNeedle: 'public int count(', newNeedle: 'public int count(', groupId: GROUP.cosmetic },
      ],
    }),
  ];
}

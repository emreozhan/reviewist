/**
 * YALNIZCA TEST İÇİN: fixtures/EXPECTED.md (main...feature/ai-refactor) beklentilerinin A2 (analiz) ile ilgili kısmı.
 * Tüm uyuşmazlıkları tek seferde görmek için hata fırlatmak yerine sorun listesi döner.
 */
import type { MemberChange, ReviewModel, RiskLevel } from '../../shared/types.js';
import { RISK_LEVEL_ORDER } from '../analysis/util.js';

const S = 'com.acme.shop';
const P = 'src/main/java/com/acme/shop';
const T = 'src/test/java/com/acme/shop';

export function checkFixtureExpectations(model: ReviewModel, expectedMd: string): string[] {
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);
  if (!expectedMd.includes('feature/ai-refactor')) fail('EXPECTED.md beklenen biçimde değil');

  const members = new Map<string, MemberChange>();
  for (const t of model.types) for (const m of t.members) members.set(m.id, m);
  const file = (p: string) => model.files.find((f) => f.path === p);
  const atLeast = (id: string, level: RiskLevel, code?: RegExp) => {
    const m = members.get(id);
    if (!m) return fail(`üye yok: ${id}`);
    if (RISK_LEVEL_ORDER[m.risk.level] < RISK_LEVEL_ORDER[level]) fail(`${id}: risk ${m.risk.level} (${m.risk.score}) < ${level}; nedenler: ${m.risk.reasons.map((r) => r.code).join(',')}`);
    if (code && !m.risk.reasons.some((r) => code.test(r.code))) fail(`${id}: ${code} nedeni yok (${m.risk.reasons.map((r) => r.code).join(',')})`);
  };

  // 1. Dosya düzeyi
  const s = model.summary;
  if (s.files !== 28) fail(`summary.files = ${s.files} (28 beklenir)`);
  if (s.javaFiles !== 26) fail(`summary.javaFiles = ${s.javaFiles} (26 beklenir)`);
  if (s.testFiles !== 4) fail(`summary.testFiles = ${s.testFiles} (4 beklenir)`);
  const cosmetic = model.files.filter((f) => f.cosmeticOnly).map((f) => f.path).sort();
  const expCosmetic = [`${P}/util/ReportGenerator.java`, `${T}/adapter/in/web/OrderControllerTest.java`].sort();
  if (cosmetic.join() !== expCosmetic.join()) fail(`kozmetik dosyalar: ${cosmetic.join(', ')}`);
  for (const f of model.files) if (f.parseError) fail(`parseError: ${f.path}: ${f.parseError}`);

  // 4. Risk nedenleri
  atLeast(`${S}.util.StringUtils#legacyPad(String,int)`, 'critical', /removed-with-callers/);
  atLeast(`${S}.application.port.out.PaymentGateway#charge(Money,String)`, 'high', /public-api-signature/);
  atLeast(`${S}.domain.model.Money#equals(Object)`, 'high', /equality/);
  atLeast(`${S}.domain.model.Money#hashCode()`, 'high', /equality/);
  atLeast(`${S}.adapter.out.persistence.OrderPersistenceAdapter#findById(String)`, 'medium', /empty-catch/);
  atLeast(`${S}.application.service.CancelOrderService#cancelOrder(String)`, 'medium', /annotation-transaction/);
  atLeast(`${S}.adapter.out.persistence.OrderJpaRepository#findLargeOrdersByStatus(String,BigDecimal)`, 'medium', /sql/);
  atLeast(`${S}.adapter.out.notification.AbstractNotifier#notify(Order)`, 'high', /template-method/);
  atLeast(`${S}.adapter.out.notification.AbstractNotifier#notify(Order)`, 'high', /print-stack-trace/);
  atLeast(`${S}.adapter.out.notification.AbstractNotifier#channelName()`, 'medium', /interface-contract/);
  atLeast(`${S}.domain.service.PricingService#calculateTotal(Order)`, 'medium', /callers-outside-diff/);
  atLeast(`${S}.domain.model.Order#totalAmount()`, 'medium', /public-api-renamed/);
  atLeast(`${S}.adapter.in.web.OrderController#placeOrderService`, 'medium', /architecture/);
  const yml = file('src/main/resources/application.yml');
  if (!yml || RISK_LEVEL_ORDER[yml.risk.level] < RISK_LEVEL_ORDER.medium) fail(`application.yml riski: ${yml?.risk.level}`);
  const rg = file(`${P}/util/ReportGenerator.java`);
  if (rg?.risk.level !== 'low') fail(`ReportGenerator riski: ${rg?.risk.level}`);
  const legacyFax = model.findings.find((f) => f.id.includes('LegacyFaxNotifier') && f.severity === 'error');
  if (legacyFax) fail(`LegacyFaxNotifier için yanlış hata bulgusu: ${legacyFax.title}`);

  // Silinmiş ama çağrılan → error bulgusu
  const stale = model.findings.find((f) => f.severity === 'error' && f.category === 'callers' && f.symbolIds?.includes(`${S}.util.StringUtils#legacyPad(String,int)`));
  if (!stale) fail('legacyPad için error bulgusu yok');
  else if (!stale.message.includes('PaymentReference.java')) fail(`legacyPad bulgusu PaymentReference'ı göstermiyor: ${stale.message}`);

  // 2.8 Mimari
  const arch = model.findings.filter((f) => f.category === 'architecture');
  const hasArch = (rule: string, path: string) => arch.some((f) => f.id.startsWith(`architecture:${rule}:`) && f.file === path && f.severity !== 'info');
  if (!hasArch('domain-framework', `${P}/domain/model/Order.java`)) fail('Order.java domain-framework ihlali yok');
  if (!hasArch('field-injection', `${P}/adapter/in/web/OrderController.java`)) fail('OrderController @Autowired alan ihlali yok');
  if (!hasArch('controller-service', `${P}/adapter/in/web/OrderController.java`)) fail('OrderController → PlaceOrderService ihlali yok');
  if (!hasArch('domain-outer', `${P}/domain/service/OrderValidator.java`)) fail('OrderValidator domain → application ihlali yok');
  for (const f of arch) if (f.title.includes('önceden de vardı')) fail(`main'de ihlal yok ama 'önceden de vardı' denmiş: ${f.id}`);
  if (arch.some((f) => f.file?.endsWith('CancelOrderService.java'))) fail('CancelOrderService için yanlış mimari bulgu');

  // 5. Test uyarıları
  const testF = model.findings.filter((f) => f.category === 'test');
  for (const p of [`${P}/domain/service/PricingService.java`, `${P}/domain/model/Money.java`]) {
    if (!testF.some((f) => f.id === `test:stale:${p}`)) fail(`"ilgili test güncellenmemiş" yok: ${p}`);
  }
  const untested = ['application.service.CancelOrderService', 'adapter.out.notification.AbstractNotifier', 'adapter.out.notification.EmailNotifier', 'adapter.out.notification.SmsNotifier', 'adapter.out.notification.PushNotifier', 'adapter.out.payment.StripePaymentAdapter', 'adapter.out.payment.PaypalPaymentAdapter', 'adapter.out.persistence.OrderPersistenceAdapter', 'adapter.out.persistence.OrderJpaRepository', 'adapter.out.persistence.OrderMapper'];
  for (const t of untested) {
    const fqn = `${S}.${t}`;
    if (!testF.some((f) => f.symbolIds?.includes(fqn) && /untested/.test(f.id))) fail(`"test yok" bulgusu yok: ${fqn}`);
    const fc = model.files.find((f) => f.typeIds.includes(fqn));
    if (fc && fc.relatedTestFiles.length) fail(`${fqn} relatedTestFiles boş olmalı: ${fc.relatedTestFiles.join(', ')}`);
  }
  if (s.untestedChanges < 10) fail(`untestedChanges = ${s.untestedChanges} (≥10 beklenir)`);
  for (const t of ['domain.model.Order', 'application.service.PlaceOrderService', 'adapter.in.web.OrderController', 'domain.service.OrderValidator']) {
    if (testF.some((f) => f.symbolIds?.includes(`${S}.${t}`) && /untested/.test(f.id))) fail(`${t} için yanlış "test yok" bulgusu`);
  }
  const validator = file(`${P}/domain/service/OrderValidator.java`);
  if (!validator?.relatedTestFiles.includes(`${T}/domain/service/OrderValidatorTest.java`)) fail(`OrderValidator testi eşlenmedi: ${validator?.relatedTestFiles.join(', ')}`);

  // 3. Etkilenenler
  const node = (id: string) => model.graph.nodes.find((n) => n.id === id);
  for (const id of [`${S}.adapter.in.web.OrderController#quote(OrderRequest)`, `${S}.adapter.in.web.OrderController#placeOrder(OrderRequest)`, `${S}.adapter.in.web.OrderController#cancel(String)`, `${S}.adapter.out.payment.PaymentReference#next(String)`]) {
    if (node(id)?.status !== 'impacted') fail(`impacted değil: ${id} (${node(id)?.status ?? 'düğüm yok'})`);
  }
  for (const sub of ['EmailNotifier', 'SmsNotifier', 'PushNotifier']) {
    const from = `${S}.adapter.out.notification.${sub}`;
    if (!model.graph.edges.some((e) => e.kind === 'extends' && e.from === from && e.to === `${S}.adapter.out.notification.AbstractNotifier`)) fail(`extends kenarı yok: ${sub} → AbstractNotifier`);
  }
  if (s.impactedOutsideDiff < 6) fail(`impactedOutsideDiff = ${s.impactedOutsideDiff} (≥6 beklenir)`);
  const pricingTests = model.graph.nodes.filter((n) => n.id.startsWith(`${S}.domain.service.PricingServiceTest#`));
  if (!pricingTests.length) fail('PricingServiceTest metotları grafikte yok');
  else if (pricingTests.some((n) => n.layer !== 'test' || n.status !== 'impacted')) fail('PricingServiceTest düğümleri test/impacted değil');
  const bean = model.graph.nodes.filter((n) => n.id.startsWith(`${S}.config.BeanConfig`));
  if (bean.length) fail(`BeanConfig yanlış pozitif impacted: ${bean.map((n) => n.id).join(', ')}`);

  // Okuma planı
  const order = (suffix: string) => model.reviewPlan.find((x) => x.fileId.endsWith(suffix))?.order ?? -1;
  const before = (a: string, b: string) => {
    if (!(order(a) > 0 && order(a) < order(b))) fail(`plan: ${a} (${order(a)}) ${b} (${order(b)}) öncesinde değil`);
  };
  before('/PaymentGateway.java', '/StripePaymentAdapter.java');
  before('/PaymentGateway.java', '/PaypalPaymentAdapter.java');
  before('/AbstractNotifier.java', '/EmailNotifier.java');
  before('/Order.java', '/OrderMapper.java');
  const last2 = model.reviewPlan.slice(-2).map((x) => x.fileId).sort();
  if (last2.join() !== expCosmetic.join()) fail(`plan sonu kozmetik değil: ${last2.join(', ')}`);
  if (model.reviewPlan.length !== model.files.length) fail('plan her dosyayı içermiyor');

  // Gruplar
  const g = model.groups.find((x) => x.symbolIds.includes(`${S}.application.port.out.PaymentGateway#charge(Money,String)`));
  if (!g) fail('PaymentGateway.charge grubu yok');
  else if (!g.symbolIds.includes(`${S}.adapter.out.payment.StripePaymentAdapter#charge(Money,String)`)) fail(`charge grubu implementasyonu içermiyor: ${g.title}`);
  return problems;
}

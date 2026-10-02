/**
 * Entegrasyon: fixtures/sample-repo üzerinde fixtures/EXPECTED.md beklentileri (A1 kapsamı: ayrıştırma, semantik diff, repo indeksi).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseJavaFile } from './extract.js';
import type { JavaFileModel, TypeDiff } from './model.js';
import { RepoIndex } from './repoIndex.js';
import { detectCrossFileMoves, diffJavaFile } from './semanticDiff.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/sample-repo');
const HAS_FIXTURE = existsSync(join(REPO, '.git'));

const S = 'com.acme.shop';

function git(...args: string[]): string {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function show(ref: string, path: string): string {
  return git('show', `${ref}:${path}`);
}

async function diffBranches(base: string, head: string): Promise<TypeDiff[]> {
  const lines = git('diff', '-M', '--name-status', `${base}...${head}`).trim().split('\n');
  const diffs: TypeDiff[] = [];
  for (const line of lines) {
    const [status = '', a = '', b] = line.split('\t');
    const newPath = b ?? a;
    if (!newPath.endsWith('.java')) continue;
    const oldPath = a;
    const oldM = status === 'A' ? undefined : await parseJavaFile(oldPath, show(base, oldPath));
    const newM = status === 'D' ? undefined : await parseJavaFile(newPath, show(head, newPath));
    diffs.push(...diffJavaFile(oldM, newM, { oldPath, newPath }));
  }
  detectCrossFileMoves(diffs);
  return diffs;
}

async function parseBranch(ref: string): Promise<JavaFileModel[]> {
  const paths = git('ls-tree', '-r', '--name-only', ref)
    .trim()
    .split('\n')
    .filter((p) => p.endsWith('.java'));
  return Promise.all(paths.map(async (p) => parseJavaFile(p, show(ref, p))));
}

describe.skipIf(!HAS_FIXTURE)('fikstür: main...feature/ai-refactor', () => {
  let diffs: TypeDiff[] = [];
  let head: JavaFileModel[] = [];
  let idx: RepoIndex;
  const memberStatus = new Map<string, string>();

  beforeAll(async () => {
    diffs = await diffBranches('main', 'feature/ai-refactor');
    head = await parseBranch('feature/ai-refactor');
    idx = RepoIndex.build(head);
    for (const td of diffs) for (const m of td.change.members) memberStatus.set(m.id, m.status);
  }, 60_000);

  const member = (id: string) => {
    for (const td of diffs) {
      const m = td.members.find((x) => x.change.id === id);
      if (m) return m;
    }
    throw new Error(`üye yok: ${id}`);
  };
  const type = (id: string) => {
    const t = diffs.find((d) => d.change.id === id);
    if (!t) throw new Error(`tip yok: ${id}`);
    return t;
  };
  const callers = (id: string) => idx.callersOf(id).map((c) => c.fromId);

  it('her iki daldaki tüm .java dosyaları hatasız ayrışır', async () => {
    const base = await parseBranch('main');
    expect(base.length).toBe(40);
    expect(base.filter((m) => m.hasErrors).map((m) => m.path)).toEqual([]);
    expect(head.filter((m) => m.hasErrors).map((m) => m.path)).toEqual([]);
  });

  it('üretim kodunda değişen üyeler beklenen kümeyle birebir aynı (geri kalan unchanged)', () => {
    const expected: Record<string, string | string[]> = {
      [`${S}.adapter.in.web.OrderController#placeOrderService`]: 'added',
      [`${S}.adapter.in.web.OrderController#placeExpressOrder(OrderRequest)`]: 'added',
      [`${S}.adapter.in.web.OrderResponse#from(Order)`]: 'modified',
      [`${S}.adapter.out.notification.AbstractNotifier#MAX_ATTEMPTS`]: 'added',
      [`${S}.adapter.out.notification.AbstractNotifier#notify(Order)`]: 'modified',
      [`${S}.adapter.out.notification.AbstractNotifier#channelName()`]: 'added',
      [`${S}.adapter.out.notification.EmailNotifier#channelName()`]: 'added',
      [`${S}.adapter.out.notification.SmsNotifier#channelName()`]: 'added',
      [`${S}.adapter.out.notification.PushNotifier#channelName()`]: 'added',
      [`${S}.adapter.out.notification.LegacyFaxNotifier#LOG`]: 'removed',
      [`${S}.adapter.out.notification.LegacyFaxNotifier#format(Order)`]: 'removed',
      [`${S}.adapter.out.notification.LegacyFaxNotifier#deliver(Customer,String)`]: 'removed',
      [`${S}.adapter.out.payment.StripePaymentAdapter#charge(Money,String)`]: 'signatureChanged',
      [`${S}.adapter.out.payment.PaypalPaymentAdapter#charge(Money,String)`]: 'signatureChanged',
      [`${S}.adapter.out.persistence.OrderJpaRepository#findLargeOrdersByStatus(String,BigDecimal)`]: 'added',
      [`${S}.adapter.out.persistence.OrderMapper#toEntity(Order)`]: 'modified',
      [`${S}.adapter.out.persistence.OrderPersistenceAdapter#findById(String)`]: 'modified',
      [`${S}.application.port.out.PaymentGateway#charge(Money,String)`]: 'signatureChanged',
      [`${S}.application.service.CancelOrderService#cancelOrder(String)`]: ['modified', 'signatureChanged'],
      [`${S}.application.service.PlaceOrderService#orderValidator`]: 'added',
      [`${S}.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)`]: 'modified',
      [`${S}.domain.model.Money#equals(Object)`]: 'modified',
      [`${S}.domain.model.Money#hashCode()`]: 'modified',
      [`${S}.domain.model.Order#totalAmount()`]: 'renamed',
      [`${S}.domain.service.OrderValidator#validate(PlaceOrderCommand)`]: 'moved',
      [`${S}.domain.service.PricingService#HIGH_VALUE_DISCOUNT_PERCENT`]: 'added',
      [`${S}.domain.service.PricingService#HIGH_VALUE_THRESHOLD`]: 'added',
      [`${S}.domain.service.PricingService#calculateTotal(Order)`]: 'modified',
      [`${S}.domain.service.PricingService#shippingCost(Order)`]: 'modified',
      [`${S}.util.StringUtils#legacyPad(String,int)`]: 'removed',
    };
    for (const n of ['DATE_FORMAT', 'ReportGenerator()', 'header(String,LocalDate)', 'formatAmount(BigDecimal,String)', 'formatRow(List,int)', 'formatTable(List,List,int)', 'padRight(String,int)']) {
      expected[`${S}.util.ReportGenerator#${n}`] = 'cosmetic';
    }
    for (const n of ['StringUtils()', 'isBlank(String)', 'truncate(String,int)', 'maskEmail(String)', 'toUpperSnake(String)']) {
      expected[`${S}.util.StringUtils#${n}`] = 'cosmetic';
    }
    const actual: Record<string, string> = {};
    for (const td of diffs) {
      if (!td.change.file.startsWith('src/main/')) continue;
      for (const m of td.change.members) if (m.status !== 'unchanged') actual[m.id] = m.status;
    }
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [id, st] of Object.entries(expected)) {
      if (Array.isArray(st)) expect(st).toContain(actual[id]);
      else expect({ id, status: actual[id] }).toEqual({ id, status: st });
    }
  });

  it('2.1 arayüz imza değişikliği: oldId, flags, override ve çağıranlar', () => {
    const pg = member(`${S}.application.port.out.PaymentGateway#charge(Money,String)`).change;
    expect(pg.oldId).toBe(`${S}.application.port.out.PaymentGateway#charge(Money)`);
    expect(pg.flags).toEqual(expect.arrayContaining(['params', 'javadoc']));
    for (const impl of ['StripePaymentAdapter', 'PaypalPaymentAdapter']) {
      const c = member(`${S}.adapter.out.payment.${impl}#charge(Money,String)`).change;
      expect(c.oldId).toBe(`${S}.adapter.out.payment.${impl}#charge(Money)`);
      expect(c.flags).toEqual(expect.arrayContaining(['params', 'body']));
      expect(idx.overridesOf(c.id)).toEqual([pg.id]);
    }
    expect(idx.overriddenBy(pg.id).sort()).toEqual([
      `${S}.adapter.out.payment.PaypalPaymentAdapter#charge(Money,String)`,
      `${S}.adapter.out.payment.StripePaymentAdapter#charge(Money,String)`,
    ]);
    expect(idx.subTypesOf(`${S}.application.port.out.PaymentGateway`).sort()).toEqual([
      `${S}.adapter.out.payment.PaypalPaymentAdapter`,
      `${S}.adapter.out.payment.StripePaymentAdapter`,
    ]);
    expect(callers(pg.id).sort()).toEqual([
      `${S}.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)`,
      `${S}.application.service.PlaceOrderServiceTest#shouldChargeAndPersistOrder_whenCommandIsValid()`,
      `${S}.application.service.PlaceOrderServiceTest#shouldRejectOrder_whenCommandHasNoLines()`,
    ]);
  });

  it('2.2 davranış değişikliği ve diff dışı çağıranlar', () => {
    const c = member(`${S}.domain.service.PricingService#calculateTotal(Order)`).change;
    expect(c.flags).toContain('body');
    const refs = idx.callersOf(c.id);
    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromId: `${S}.adapter.in.web.OrderController#quote(OrderRequest)`, line: 57 }),
        expect.objectContaining({ fromId: `${S}.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)` }),
      ]),
    );
    expect(refs.some((r) => r.fromId.startsWith(`${S}.domain.service.PricingServiceTest#`))).toBe(true);
    expect(memberStatus.get(`${S}.domain.service.PricingService#totalQuantity(Order)`)).toBe('unchanged');
  });

  it('2.3 abstract base: template method, yeni abstract metot, alt tipler', () => {
    const notify = member(`${S}.adapter.out.notification.AbstractNotifier#notify(Order)`);
    expect(notify.change.flags).toContain('body');
    expect(notify.oldMember?.complexity).toBe(1);
    expect(notify.newMember?.complexity).toBeGreaterThan(1);
    expect(notify.newMember?.features.printStackTrace).toBe(1);
    expect(idx.overridesOf(notify.change.id)).toEqual([`${S}.application.port.out.NotificationPort#notify(Order)`]);
    const ch = member(`${S}.adapter.out.notification.AbstractNotifier#channelName()`);
    expect(ch.newMember?.modifiers).toContain('abstract');
    expect(idx.overriddenBy(ch.change.id).sort()).toEqual(
      ['EmailNotifier', 'PushNotifier', 'SmsNotifier'].map((n) => `${S}.adapter.out.notification.${n}#channelName()`),
    );
    expect(idx.subTypesOf(`${S}.adapter.out.notification.AbstractNotifier`).sort()).toEqual(
      ['EmailNotifier', 'PushNotifier', 'SmsNotifier'].map((n) => `${S}.adapter.out.notification.${n}`),
    );
    expect(callers(`${S}.application.port.out.NotificationPort#notify(Order)`).sort()).toEqual([
      `${S}.application.service.CancelOrderService#cancelOrder(String)`,
      `${S}.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)`,
      `${S}.application.service.PlaceOrderServiceTest#shouldChargeAndPersistOrder_whenCommandIsValid()`,
    ]);
  });

  it('2.4 yeniden adlandırma: totalAmount ve çağıranları; getTotal çağrısı kalmadı', () => {
    const r = member(`${S}.domain.model.Order#totalAmount()`).change;
    expect(r).toMatchObject({ status: 'renamed', oldId: `${S}.domain.model.Order#getTotal()`, oldName: 'getTotal' });
    expect(idx.findCallsTo(`${S}.domain.model.Order`, 'getTotal', 0)).toEqual([]);
    expect(callers(r.id).sort()).toEqual(
      [
        `${S}.adapter.in.web.OrderResponse#from(Order)`,
        `${S}.adapter.out.persistence.OrderMapper#toEntity(Order)`,
        `${S}.application.service.PlaceOrderServiceTest#shouldChargeAndPersistOrder_whenCommandIsValid()`,
        `${S}.domain.model.OrderTest#shouldSumLineTotals_whenLinesAdded()`,
        `${S}.domain.service.PricingService#calculateTotal(Order)`,
        `${S}.domain.service.PricingService#shippingCost(Order)`,
      ].sort(),
    );
  });

  it('2.5 taşıma: validate tek moved kayıt, görünürlük ayrıntısı', () => {
    const mv = member(`${S}.domain.service.OrderValidator#validate(PlaceOrderCommand)`).change;
    expect(mv.oldId).toBe(`${S}.application.service.PlaceOrderService#validate(PlaceOrderCommand)`);
    expect(mv.details).toContain('görünürlük: private → public');
    expect(memberStatus.has(`${S}.application.service.PlaceOrderService#validate(PlaceOrderCommand)`)).toBe(false);
    expect(type(`${S}.domain.service.OrderValidator`).change.status).toBe('added');
    expect(member(`${S}.application.service.PlaceOrderService#orderValidator`).newMember?.initializerText).toBe('new OrderValidator()');
    expect(memberStatus.get(`${S}.application.service.PlaceOrderService#PlaceOrderService(OrderRepository,PaymentGateway,NotificationPort,PricingService)`)).toBe('unchanged');
    expect(idx.overridesOf(`${S}.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)`)).toEqual([
      `${S}.application.port.in.PlaceOrderUseCase#placeOrder(PlaceOrderCommand)`,
    ]);
    const vc = callers(mv.id);
    expect(vc).toContain(`${S}.application.service.PlaceOrderService#placeOrder(PlaceOrderCommand)`);
    expect(vc.some((c) => c.startsWith(`${S}.domain.service.OrderValidatorTest#`))).toBe(true);
  });

  it('2.6 kozmetik dosyalar ve yalnız import eklenen test', () => {
    const rg = type(`${S}.util.ReportGenerator`);
    expect(rg.change.status).toBe('cosmetic');
    expect(rg.change.members.every((m) => m.status === 'cosmetic' && m.flags.includes('formatting'))).toBe(true);
    expect(type(`${S}.util.StringUtils`).change.status).toBe('modified');
    const ct = type(`${S}.adapter.in.web.OrderControllerTest`);
    expect(ct.change.status).toBe('unchanged');
    expect(ct.change.members.every((m) => m.status === 'unchanged')).toBe(true);
  });

  it('2.7 riskli değişikliklerin özellikleri', () => {
    const cancel = member(`${S}.application.service.CancelOrderService#cancelOrder(String)`).change;
    expect(cancel.flags).toContain('annotations');
    expect(cancel.details).toContain('@Transactional eklendi');
    expect(idx.overridesOf(cancel.id)).toEqual([`${S}.application.port.in.CancelOrderUseCase#cancelOrder(String)`]);
    const find = member(`${S}.adapter.out.persistence.OrderPersistenceAdapter#findById(String)`).newMember;
    expect(find?.features.emptyCatches).toBe(1);
    const q = member(`${S}.adapter.out.persistence.OrderJpaRepository#findLargeOrdersByStatus(String,BigDecimal)`).newMember;
    expect(q?.annotations.some((a) => a.startsWith('@Query("SELECT o FROM'))).toBe(true);
    expect(q?.features.sqlStrings).toBe(1);
  });

  it('2.8 / 2.9 tip düzeyi: @Component, OrderRequest taşındı, LegacyFaxNotifier silindi', () => {
    const order = type(`${S}.domain.model.Order`);
    expect(order.change.flags).toContain('annotations');
    expect(order.change.details).toContain('@Component eklendi');
    const req = type(`${S}.adapter.in.web.dto.OrderRequest`);
    expect(['moved', 'renamed']).toContain(req.change.status);
    expect(req.change.oldId).toBe(`${S}.adapter.in.web.OrderRequest`);
    expect(req.change.members.every((m) => m.status === 'unchanged')).toBe(true);
    expect(type(`${S}.adapter.in.web.dto.OrderRequest.LineRequest`).change.oldId).toBe(`${S}.adapter.in.web.OrderRequest.LineRequest`);
    const fax = type(`${S}.adapter.out.notification.LegacyFaxNotifier`);
    expect(fax.change.status).toBe('removed');
    expect(idx.filesReferencingType(fax.change.id)).toEqual([]);
    expect(idx.findCallsTo(fax.change.id, 'format', 1).filter((r) => r.confidence !== 'name-only')).toEqual([]);
  });

  it('2.10 silinmiş ama hâlâ çağrılan: legacyPad', () => {
    expect(idx.findCallsTo(`${S}.util.StringUtils`, 'legacyPad', 2)).toEqual([
      {
        fromId: `${S}.adapter.out.payment.PaymentReference#next(String)`,
        file: 'src/main/java/com/acme/shop/adapter/out/payment/PaymentReference.java',
        line: 14,
        inChangedCode: false,
        confidence: 'exact',
      },
    ]);
  });

  it('3. diff dışı etki: controller port çağrıları ve BeanConfig yalnız yapıcı çağırır', () => {
    expect(callers(`${S}.application.port.in.PlaceOrderUseCase#placeOrder(PlaceOrderCommand)`)).toContain(
      `${S}.adapter.in.web.OrderController#placeOrder(OrderRequest)`,
    );
    expect(callers(`${S}.application.port.in.CancelOrderUseCase#cancelOrder(String)`)).toContain(
      `${S}.adapter.in.web.OrderController#cancel(String)`,
    );
    const bean = idx.getType(`${S}.config.BeanConfig`);
    const callees = (bean?.members ?? []).flatMap((m) => idx.calleesOf(m.id));
    expect(callees.length).toBeGreaterThan(0);
    for (const c of callees) {
      const rm = idx.getMember(c);
      expect(rm === undefined ? idx.getType(c) !== undefined : rm.member.kind === 'constructor').toBe(true);
    }
  });
});

describe.skipIf(!HAS_FIXTURE)('fikstür: main...feature/small-fix', () => {
  it('yalnız cancelOrder modified (body), karmaşıklık +1', async () => {
    const diffs = await diffBranches('main', 'feature/small-fix');
    const changed = diffs.flatMap((d) => d.members).filter((m) => m.change.status !== 'unchanged');
    expect(changed.map((m) => m.change.id)).toEqual([`${S}.application.service.CancelOrderService#cancelOrder(String)`]);
    const m = changed[0];
    expect(m?.change.status).toBe('modified');
    expect(m?.change.flags).toEqual(['body']);
    expect((m?.newMember?.complexity ?? 0) - (m?.oldMember?.complexity ?? 0)).toBe(1);
  });
});

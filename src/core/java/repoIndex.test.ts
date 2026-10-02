import { beforeAll, describe, expect, it } from 'vitest';
import { parseJavaFile } from './extract.js';
import type { JavaFileModel } from './model.js';
import { RepoIndex } from './repoIndex.js';

const FILES: Record<string, string> = {
  'src/com/acme/port/NotificationPort.java': `package com.acme.port;
import com.acme.model.Order;
public interface NotificationPort {
  void notify(Order order);
}
`,
  'src/com/acme/notify/AbstractNotifier.java': `package com.acme.notify;
import com.acme.model.Order;
import com.acme.port.NotificationPort;
public abstract class AbstractNotifier implements NotificationPort {
  protected Sender sender;
  @Override
  public void notify(Order order) {
    deliver(format(order));
  }
  protected abstract String format(Order order);
  protected void deliver(String msg) { sender.send(msg); }
  public static AbstractNotifier noop() { return null; }
}
`,
  'src/com/acme/notify/EmailNotifier.java': `package com.acme.notify;
import com.acme.model.Order;
public class EmailNotifier extends AbstractNotifier {
  public EmailNotifier() {}
  public EmailNotifier(String host) { this(); }
  @Override
  protected String format(Order order) { return "mail:" + order.id(); }
}
`,
  'src/com/acme/notify/HtmlEmailNotifier.java': `package com.acme.notify;
import com.acme.model.Order;
public class HtmlEmailNotifier extends EmailNotifier {
  @Override
  protected String format(Order order) { return "<b>" + super.format(order) + "</b>"; }
}
`,
  'src/com/acme/notify/Sender.java': `package com.acme.notify;
public class Sender {
  public void send(String msg) {}
  public void send(String msg, int retries) {}
  public void sendAll(String... msgs) {}
}
`,
  'src/com/acme/model/Order.java': `package com.acme.model;
public class Order {
  private final String id;
  public Order(String id) { this.id = id; }
  public String id() { return id; }
  public static Order of(String id) { return new Order(id); }
  public static class Line {
    int qty;
    public int qty() { return qty; }
  }
}
`,
  'src/com/acme/repo/Repository.java': `package com.acme.repo;
public interface Repository<T, ID> {
  T findById(ID id);
  void save(T entity);
}
`,
  'src/com/acme/repo/OrderRepository.java': `package com.acme.repo;
import com.acme.model.Order;
public class OrderRepository implements Repository<Order, String> {
  public Order findById(String id) { return null; }
  public void save(Order entity) {}
}
`,
  'src/com/acme/app/OrderService.java': `package com.acme.app;
import com.acme.model.*;
import com.acme.port.NotificationPort;
import com.acme.repo.OrderRepository;
import com.acme.notify.EmailNotifier;
import static com.acme.app.Util.helper;
public class OrderService {
  private final NotificationPort port;
  private final OrderRepository repo;
  private EmailNotifier email;
  public OrderService(NotificationPort port, OrderRepository repo) {
    this.port = port;
    this.repo = repo;
  }
  public void place(String id) {
    Order order = Order.of(id);
    port.notify(order);
    this.repo.save(order);
    email.notify(order);
    helper(order);
    Order.Line line = new Order.Line();
    line.qty();
    java.util.List<Order> list = new java.util.ArrayList<>();
    list.add(order);
    build().id();
    new Order("x").id();
    Runnable r = () -> repo.findById(id);
  }
  private Order build() { return new Order("y"); }
}
`,
  'src/com/acme/app/Util.java': `package com.acme.app;
public final class Util {
  public static void helper(Object o) {}
  public static void process(String a) {}
  public static void process(String a, String b) {}
}
`,
  'src/com/acme/app/Other.java': `package com.acme.app;
public class Other {
  void run(Object x) {
    x.toString();
    unknownThing().process("a");
    mystery().format(null);
    something().send("hi");
  }
}
`,
  'src/com/acme/legacy/Client.java': `package com.acme.legacy;
import com.acme.model.Order;
import com.acme.removed.LegacyService;
public class Client {
  private LegacyService legacy;
  void call(Order o) {
    legacy.oldMethod(o, 1);
    legacy.oldMethod(o);
  }
}
`,
  'src/com/acme/chain/Customer.java': `package com.acme.chain;
public class Customer {
  public String getName() { return "n"; }
  public Address getAddress() { return null; }
}
`,
  'src/com/acme/chain/Address.java': `package com.acme.chain;
public class Address {
  public String city() { return ""; }
}
`,
  'src/com/acme/chain/InvoiceRepo.java': `package com.acme.chain;
import java.util.List;
public interface InvoiceRepo {
  List<Invoice> findAll();
  Invoice latest(String key);
}
`,
  'src/com/acme/chain/Invoice.java': `package com.acme.chain;
import java.util.Optional;
public class Invoice {
  private Customer customer;
  private InvoiceRepo repo;
  public Customer getCustomer() { return customer; }
  public Optional<Customer> findCustomer() { return Optional.empty(); }
  public <T> T generic() { return null; }
  void use(Invoice other) {
    String k = "x";
    getCustomer().getName();
    other.getCustomer().getAddress().city();
    this.repo.findAll().stream();
    findCustomer().get().getName();
    new Invoice().getCustomer().getName();
    ((Invoice) other).getCustomer().getAddress();
    this.repo.latest(String.format("a, (b", k)).getCustomer();
    a().b().c().d().e().getName();
    generic().getName();
  }
}
`,
  'src/com/acme/inh/Greet.java': `package com.acme.inh;
interface Greeter { String greet(String n); }
class BaseGreeter { public String greet(String n) { return "hi " + n; } }
class LoudGreeter extends BaseGreeter implements Greeter {}
class SilentGreeter extends BaseGreeter implements Greeter { public String greet(String n) { return ""; } }
abstract class AbstractBase { public abstract String greet(String n); }
class Weird extends AbstractBase implements Greeter { public String greet(String n) { return n; } }
class LoopA extends LoopB implements Greeter {}
class LoopB extends LoopA { public String greet(String n) { return n; } }
`,
  'src/com/acme/legacy/Cycle.java': `package com.acme.legacy;
class CycleA extends CycleB {}
class CycleB extends CycleA {}
`,
};

let files: JavaFileModel[] = [];
let idx: RepoIndex;

beforeAll(async () => {
  files = await Promise.all(Object.entries(FILES).map(([p, s]) => parseJavaFile(p, s)));
  idx = RepoIndex.build(files);
});

function file(p: string): JavaFileModel {
  const f = idx.files.get(p);
  if (!f) throw new Error(`dosya yok: ${p}`);
  return f;
}

describe('RepoIndex: temel sorgular ve tip çözümleme', () => {
  it('tip, dosya ve üye arama', () => {
    expect(idx.getType('com.acme.model.Order')?.name).toBe('Order');
    expect(idx.getType('com.acme.model.Order.Line')?.outerFqn).toBe('com.acme.model.Order');
    expect(idx.getFileOfType('com.acme.model.Order')?.path).toBe('src/com/acme/model/Order.java');
    const rm = idx.getMember('com.acme.model.Order#id()');
    expect(rm?.type.fqn).toBe('com.acme.model.Order');
    expect(rm?.file.path).toBe('src/com/acme/model/Order.java');
    expect(idx.getMember('yok#yok()')).toBeUndefined();
  });

  it('resolveTypeName: tek import, wildcard, aynı paket, iç tip, java.lang, repo dışı, FQN', () => {
    const svc = file('src/com/acme/app/OrderService.java');
    const svcType = idx.getType('com.acme.app.OrderService');
    expect(idx.resolveTypeName('OrderRepository', svc)).toBe('com.acme.repo.OrderRepository');
    expect(idx.resolveTypeName('Order', svc)).toBe('com.acme.model.Order'); // wildcard
    expect(idx.resolveTypeName('Util', svc)).toBe('com.acme.app.Util'); // aynı paket
    expect(idx.resolveTypeName('Order.Line', svc)).toBe('com.acme.model.Order.Line');
    expect(idx.resolveTypeName('List<Order>', svc)).toBeUndefined(); // repo dışı
    expect(idx.resolveTypeName('String', svc)).toBeUndefined(); // java.lang
    expect(idx.resolveTypeName('com.acme.notify.Sender', svc)).toBe('com.acme.notify.Sender');
    expect(idx.resolveTypeName('NotificationPort[]', svc, svcType)).toBe('com.acme.port.NotificationPort');
    const order = file('src/com/acme/model/Order.java');
    expect(idx.resolveTypeName('Line', order, idx.getType('com.acme.model.Order'))).toBe('com.acme.model.Order.Line');
    expect(idx.resolveTypeName('Order', order, idx.getType('com.acme.model.Order.Line'))).toBe('com.acme.model.Order');
    const repo = file('src/com/acme/repo/Repository.java');
    expect(idx.resolveTypeName('T', repo, idx.getType('com.acme.repo.Repository'))).toBeUndefined(); // tip değişkeni
  });

  it('üst/alt tipler: doğrudan, geçişli, çözülemeyen ham ad ve döngüye dayanıklılık', () => {
    expect(idx.superTypesOf('com.acme.notify.AbstractNotifier')).toEqual(['com.acme.port.NotificationPort']);
    expect(idx.superTypesOf('com.acme.notify.HtmlEmailNotifier')).toEqual(['com.acme.notify.EmailNotifier']);
    expect(idx.subTypesOf('com.acme.port.NotificationPort')).toEqual(['com.acme.notify.AbstractNotifier']);
    expect(idx.subTypesOf('com.acme.port.NotificationPort', true).sort()).toEqual([
      'com.acme.notify.AbstractNotifier',
      'com.acme.notify.EmailNotifier',
      'com.acme.notify.HtmlEmailNotifier',
    ]);
    expect(idx.subTypesOf('com.acme.legacy.CycleA', true)).toEqual(['com.acme.legacy.CycleB']);
    expect(idx.superTypesOf('com.acme.repo.OrderRepository')).toEqual(['com.acme.repo.Repository']);
  });
});

describe('RepoIndex: override ilişkileri', () => {
  it('arayüz + abstract + geçişli override', () => {
    expect(idx.overridesOf('com.acme.notify.AbstractNotifier#notify(Order)')).toEqual(['com.acme.port.NotificationPort#notify(Order)']);
    expect(idx.overriddenBy('com.acme.notify.AbstractNotifier#format(Order)').sort()).toEqual([
      'com.acme.notify.EmailNotifier#format(Order)',
      'com.acme.notify.HtmlEmailNotifier#format(Order)',
    ]);
    expect(idx.overridesOf('com.acme.notify.HtmlEmailNotifier#format(Order)').sort()).toEqual([
      'com.acme.notify.AbstractNotifier#format(Order)',
      'com.acme.notify.EmailNotifier#format(Order)',
    ]);
    expect(idx.overriddenBy('com.acme.port.NotificationPort#notify(Order)')).toEqual(['com.acme.notify.AbstractNotifier#notify(Order)']);
  });

  it('generic tip değişkenleri joker kabul edilir; static/private hariç', () => {
    expect(idx.overridesOf('com.acme.repo.OrderRepository#findById(String)')).toEqual(['com.acme.repo.Repository#findById(ID)']);
    expect(idx.overriddenBy('com.acme.repo.Repository#save(T)')).toEqual(['com.acme.repo.OrderRepository#save(Order)']);
    expect(idx.overridesOf('com.acme.notify.AbstractNotifier#noop()')).toEqual([]);
    expect(idx.overridesOf('com.acme.model.Order#Order(String)')).toEqual([]);
  });
});

describe('RepoIndex: çağrı çözümleme', () => {
  const callers = (id: string) => idx.callersOf(id).map((c) => `${c.fromId}@${c.line}:${c.confidence}`);

  it('alan tipi arayüz ise çağrı arayüz metoduna exact bağlanır', () => {
    expect(callers('com.acme.port.NotificationPort#notify(Order)')).toEqual(['com.acme.app.OrderService#place(String)@17:exact']);
  });

  it('alt tip üzerinden çağrı üst tipte tanımlı metoda bağlanır', () => {
    // email: EmailNotifier; notify AbstractNotifier'da tanımlı
    expect(callers('com.acme.notify.AbstractNotifier#notify(Order)')).toEqual(['com.acme.app.OrderService#place(String)@19:exact']);
  });

  it('this.x alan erişimi, statik çağrı, statik import, iç tip yapıcısı, lambda içi', () => {
    expect(callers('com.acme.repo.OrderRepository#save(Order)')).toEqual(['com.acme.app.OrderService#place(String)@18:exact']);
    expect(callers('com.acme.model.Order#of(String)')).toEqual(['com.acme.app.OrderService#place(String)@16:exact']);
    expect(callers('com.acme.app.Util#helper(Object)')).toEqual(['com.acme.app.OrderService#place(String)@20:exact']);
    expect(callers('com.acme.model.Order.Line')).toEqual(['com.acme.app.OrderService#place(String)@21:exact']);
    expect(callers('com.acme.model.Order.Line#qty()')).toEqual(['com.acme.app.OrderService#place(String)@22:exact']);
    expect(callers('com.acme.repo.OrderRepository#findById(String)')).toEqual(['com.acme.app.OrderService#place(String)@27:exact']);
  });

  it('yapıcılar: new X(..) argCount ile, this(..) ve super çağrıları', () => {
    expect(callers('com.acme.model.Order#Order(String)')).toEqual([
      'com.acme.model.Order#of(String)@6:exact',
      'com.acme.app.OrderService#place(String)@26:exact',
      'com.acme.app.OrderService#build()@29:exact',
    ]);
    expect(callers('com.acme.notify.EmailNotifier#EmailNotifier()')).toEqual(['com.acme.notify.EmailNotifier#EmailNotifier(String)@5:exact']);
    // super.format(order) → üst sınıf metodu (exact)
    expect(callers('com.acme.notify.EmailNotifier#format(Order)')).toContain('com.acme.notify.HtmlEmailNotifier#format(Order)@5:exact');
  });

  it('kendi tipinde/üst tipte çağrı (receiver none) ve aşırı yükleme seçimi', () => {
    expect(callers('com.acme.notify.AbstractNotifier#deliver(String)')).toEqual([
      'com.acme.notify.AbstractNotifier#notify(Order)@8:exact',
    ]);
    expect(callers('com.acme.notify.AbstractNotifier#format(Order)')).toContain('com.acme.notify.AbstractNotifier#notify(Order)@8:exact');
    // sender.send(msg): 1 argümanlı aşırı yükleme seçilir
    expect(callers('com.acme.notify.Sender#send(String)')).toContain('com.acme.notify.AbstractNotifier#deliver(String)@11:exact');
    expect(callers('com.acme.notify.Sender#send(String,int)')).toEqual([]);
  });

  it('ifade alıcıları: dönüş tipi bilinmiyorsa ad+argCount ile likely / name-only; repo dışı tip bağlanmaz', () => {
    // build().id(): build() dönüş tipi Order → exact
    expect(callers('com.acme.model.Order#id()')).toEqual(
      expect.arrayContaining([
        'com.acme.app.OrderService#place(String)@25:exact',
        'com.acme.app.OrderService#place(String)@26:exact', // new Order("x").id()
      ]),
    );
    // unknownThing().process("a") → Util#process(String) tekil aday
    expect(callers('com.acme.app.Util#process(String)')).toEqual(['com.acme.app.Other#run(Object)@5:likely']);
    // mystery().format(null): 3 aday (Abstract/Email/Html) → hepsine name-only
    for (const t of ['AbstractNotifier', 'EmailNotifier', 'HtmlEmailNotifier']) {
      expect(callers(`com.acme.notify.${t}#format(Order)`)).toContain('com.acme.app.Other#run(Object)@6:name-only');
    }
    // something().send("hi"): Sender#send(String) + send(String,int)? argCount=1 → yalnız send(String) ve tekil → likely
    expect(callers('com.acme.notify.Sender#send(String)')).toContain('com.acme.app.Other#run(Object)@7:likely');
    // list.add(order): List repo dışı → hiçbir yere bağlanmaz
    expect(idx.calleesOf('com.acme.app.OrderService#place(String)').some((c) => c.includes('#add('))).toBe(false);
    // x.toString(): Object repo dışı
    expect(idx.calleesOf('com.acme.app.Other#run(Object)').some((c) => c.includes('toString'))).toBe(false);
  });

  it('calleesOf ve CallRef alanları', () => {
    const callees = idx.calleesOf('com.acme.app.OrderService#place(String)');
    expect(callees).toEqual(
      expect.arrayContaining([
        'com.acme.port.NotificationPort#notify(Order)',
        'com.acme.repo.OrderRepository#save(Order)',
        'com.acme.model.Order#of(String)',
        'com.acme.app.Util#helper(Object)',
      ]),
    );
    const ref = idx.callersOf('com.acme.model.Order#of(String)')[0];
    expect(ref).toEqual({
      fromId: 'com.acme.app.OrderService#place(String)',
      file: 'src/com/acme/app/OrderService.java',
      line: 16,
      inChangedCode: false,
      confidence: 'exact',
    });
  });
});

describe('RepoIndex: findCallsTo ve filesReferencingType', () => {
  it('silinmiş tip/metot: callSite taranarak bulunur', () => {
    const refs = idx.findCallsTo('com.acme.removed.LegacyService', 'oldMethod', 2);
    expect(refs).toEqual([
      {
        fromId: 'com.acme.legacy.Client#call(Order)',
        file: 'src/com/acme/legacy/Client.java',
        line: 7,
        inChangedCode: false,
        confidence: 'exact',
      },
    ]);
    expect(idx.findCallsTo('com.acme.removed.LegacyService', 'oldMethod').length).toBe(2);
  });

  it('mevcut tipte: alt tip üzerinden ve kendi içinden çağrılar', () => {
    const refs = idx.findCallsTo('com.acme.notify.AbstractNotifier', 'format', 1).map((r) => `${r.fromId}:${r.confidence}`);
    expect(refs).toEqual(
      expect.arrayContaining([
        'com.acme.notify.AbstractNotifier#notify(Order):exact',
        'com.acme.notify.HtmlEmailNotifier#format(Order):exact',
        'com.acme.app.Other#run(Object):name-only',
      ]),
    );
    expect(idx.findCallsTo('com.acme.model.Order', 'getTotal', 0)).toEqual([]);
    // yapıcı: ad = tip adı
    expect(idx.findCallsTo('com.acme.model.Order', 'Order', 1).length).toBe(3);
  });

  it('filesReferencingType: import, wildcard, aynı paket; tanımlayan dosya hariç', () => {
    expect(idx.filesReferencingType('com.acme.model.Order')).toEqual([
      'src/com/acme/app/OrderService.java',
      'src/com/acme/legacy/Client.java',
      'src/com/acme/notify/AbstractNotifier.java',
      'src/com/acme/notify/EmailNotifier.java',
      'src/com/acme/notify/HtmlEmailNotifier.java',
      'src/com/acme/port/NotificationPort.java',
      'src/com/acme/repo/OrderRepository.java',
    ]);
    expect(idx.filesReferencingType('com.acme.notify.Sender')).toEqual(['src/com/acme/notify/AbstractNotifier.java']);
    expect(idx.filesReferencingType('com.acme.app.Util')).toEqual(['src/com/acme/app/OrderService.java']);
    expect(idx.filesReferencingType('com.acme.model.Order.Line')).toEqual(['src/com/acme/app/OrderService.java']);
    expect(idx.filesReferencingType('com.acme.removed.LegacyService')).toEqual(['src/com/acme/legacy/Client.java']);
  });
});

describe('RepoIndex: zincirli alıcılar (dönüş tipi / alan tipi)', () => {
  const callers = (id: string) => idx.callersOf(id).map((c) => `${c.fromId}@${c.line}:${c.confidence}`);
  const U = 'com.acme.chain.Invoice#use(Invoice)';

  it('metot çağrısı zinciri dönüş tipiyle exact çözülür', () => {
    expect(callers('com.acme.chain.Customer#getName()')).toEqual(
      expect.arrayContaining([`${U}@11:exact`, `${U}@15:exact`]),
    );
    expect(callers('com.acme.chain.Address#city()')).toEqual([`${U}@12:exact`]);
    expect(callers('com.acme.chain.Customer#getAddress()')).toEqual([`${U}@12:exact`, `${U}@16:exact`]);
    expect(callers('com.acme.chain.Invoice#getCustomer()')).toEqual([
      `${U}@11:exact`,
      `${U}@12:exact`,
      `${U}@15:exact`,
      `${U}@16:exact`,
      `${U}@17:exact`,
    ]);
    // argüman içindeki string virgül/parantez sayımı bozmaz
    expect(callers('com.acme.chain.InvoiceRepo#latest(String)')).toEqual([`${U}@17:exact`]);
  });

  it('repo dışı sarmalayıcı (Optional/List) dönüşünde bağlanmaz', () => {
    expect(callers('com.acme.chain.Customer#getName()').some((c) => c.includes('@14:'))).toBe(false);
    expect(idx.calleesOf(U).some((c) => c.includes('stream') || c.includes('#get('))).toBe(false);
  });

  it('derinlik sınırı aşılınca / tip değişkeni dönüşünde ad ile (likely) bağlanır, exact değil', () => {
    expect(callers('com.acme.chain.Customer#getName()')).toEqual(
      expect.arrayContaining([`${U}@18:likely`, `${U}@19:likely`]),
    );
  });
});

describe('RepoIndex: kalıtımla gelen implementasyon arayüzü karşılar', () => {
  const P = 'com.acme.inh';
  it('I#m overriddenBy: B#m (C extends B implements I üzerinden) dahil; abstract üst tip sayılmaz', () => {
    expect(idx.overriddenBy(`${P}.Greeter#greet(String)`).sort()).toEqual(
      [`${P}.BaseGreeter#greet(String)`, `${P}.LoopB#greet(String)`, `${P}.SilentGreeter#greet(String)`, `${P}.Weird#greet(String)`].sort(),
    );
  });

  it('B#m overridesOf: alt tip üzerinden karşıladığı arayüz metodu', () => {
    expect(idx.overridesOf(`${P}.BaseGreeter#greet(String)`)).toEqual([`${P}.Greeter#greet(String)`]);
    expect(idx.overridesOf(`${P}.SilentGreeter#greet(String)`).sort()).toEqual(
      [`${P}.BaseGreeter#greet(String)`, `${P}.Greeter#greet(String)`].sort(),
    );
    expect(idx.overridesOf(`${P}.AbstractBase#greet(String)`)).toEqual([]);
  });

  it('kalıtım döngüsünde sonlanır', () => {
    expect(idx.overridesOf(`${P}.LoopB#greet(String)`)).toEqual([`${P}.Greeter#greet(String)`]);
    expect(idx.subTypesOf(`${P}.LoopA`, true)).toEqual([`${P}.LoopB`]);
  });
});

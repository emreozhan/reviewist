/**
 * Tur 4: kod gezinme (outline / locate) — gerçek ayrıştırıcı + RepoIndex, bellek içi ve git fikstürü ChangeSet'leri.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChangeSet, FileOutline, ReviewModel, SymbolRef } from '../shared/types.js';
import { buildArtifacts, buildReview, type ReviewArtifacts } from './buildReview.js';
import { ReviewNavigator, oldToNewLineMapper } from './navigation.js';
import { createGitTestChangeSet } from './testing/gitChangeSet.js';
import { createMemoryChangeSet, computeHunks } from './testing/memoryChangeSet.js';

async function analyze(cs: ChangeSet): Promise<{ model: ReviewModel; nav: ReviewNavigator; artifacts: ReviewArtifacts }> {
  let artifacts: ReviewArtifacts | undefined;
  const model = await buildReview(cs, {
    onArtifacts: (a) => {
      artifacts = a;
    },
  });
  if (!artifacts) throw new Error('onArtifacts çağrılmadı');
  return { model, nav: new ReviewNavigator(model, artifacts), artifacts };
}

function ref(o: FileOutline | undefined, line: number, name: string, kind?: SymbolRef['kind']): SymbolRef {
  const r = o?.refs.find((x) => x.line === line && x.name === name && (kind === undefined || x.kind === kind));
  if (!r) throw new Error(`ref yok: ${line}:${name} (satırdakiler: ${o?.refs.filter((x) => x.line === line).map((x) => `${x.kind}:${x.name}`).join(', ')})`);
  return r;
}

const P = 'src/main/java/p';

const SERVICE_OLD = `package p;

import java.util.List;

public class Service {
    private final Api api;

    public Service(Api api) {
        this.api = api;
    }

    public void run(List<String> xs) {
        api.charge(1);
    }

    public void legacy() {
        api.charge(2);
    }
}
`;

const SERVICE_NEW = `package p;

import java.util.List;

public class Service<T> {
    private final Api api;
    private final Model model = Model.create();

    public Service(Api api) {
        this.api = api;
    }

    public void run(List<String> xs) {
        api.charge(1);
        Util.helper();
        Runnable r = Util::helper;
        Model m = new Model();
        Model.Inner in = new Model.Inner();
        Object o = (Model) null;
        Class<?> c = Model.class;
        T t = null;
        Missing gone = null;
        Runnable q = new Runnable() {
            public void run() { api.charge(3); }
        };
    }

    static class Local {
        void x() { new Service<String>(null).run(null); }
    }
}
`;

const API_OLD = 'package p;\n\npublic interface Api {\n    void charge(int amount);\n}\n';
const API_NEW = 'package p;\n\npublic interface Api {\n    void charge(int amount);\n\n    void refund(int amount);\n}\n';

const UTIL = `package p;

public class Util {
    public static void helper() { }

    static class Deep {
        void d() { helper(); }
    }
}
`;

const MODEL = `package p;

public class Model {
    public static Model create() { return new Model(); }

    public static class Inner { }
}
`;

const GONE = 'package p;\n\npublic class Gone {\n    void bye() { }\n}\n';

function scenario(): ChangeSet {
  return createMemoryChangeSet({
    old: { [`${P}/Service.java`]: SERVICE_OLD, [`${P}/Api.java`]: API_OLD, [`${P}/Gone.java`]: GONE },
    new: { [`${P}/Service.java`]: SERVICE_NEW, [`${P}/Api.java`]: API_NEW },
    extraNewFiles: { [`${P}/Util.java`]: UTIL, [`${P}/Model.java`]: MODEL, 'README.md': '# readme\n' },
  });
}

describe('outline', () => {
  it('diff içi dosya (new): çağrı, statik çağrı, method ref, yapıcı, iç tip, cast, X.class, tip değişkeni, anonim sınıf', async () => {
    const cs = scenario();
    const { nav } = await analyze(cs);
    const o = await nav.outline(cs, `${P}/Service.java`, 'new');
    expect(o).toMatchObject({ path: `${P}/Service.java`, side: 'new', inDiff: true, packageName: 'p' });
    expect(ref(o, 14, 'charge')).toMatchObject({ kind: 'call', startCol: 12, endCol: 18, targets: ['p.Api#charge(int)'], confidence: 'exact' });
    // statik çağrı: alıcı tip + metot
    expect(ref(o, 15, 'Util', 'type')).toMatchObject({ startCol: 8, endCol: 12, targets: ['p.Util'], confidence: 'exact' });
    expect(ref(o, 15, 'helper')).toMatchObject({ kind: 'call', targets: ['p.Util#helper()'] });
    expect(ref(o, 16, 'helper')).toMatchObject({ kind: 'methodRef', startCol: 27, endCol: 33, targets: ['p.Util#helper()'] });
    // yapıcı: tip referansı ayrıca dönmez (aynı konum)
    const ctor = ref(o, 17, 'Model', 'constructor');
    expect(ctor).toMatchObject({ startCol: 22, endCol: 27, targets: ['p.Model'] });
    expect(o?.refs.filter((x) => x.line === 17 && x.startCol === 22)).toHaveLength(1);
    // iç tip (nitelikli ad, konum = Inner)
    expect(ref(o, 18, 'Model.Inner', 'type')).toMatchObject({ startCol: 14, endCol: 19, targets: ['p.Model.Inner'] });
    expect(ref(o, 18, 'Model.Inner', 'constructor').targets).toEqual(['p.Model.Inner']);
    expect(ref(o, 19, 'Model', 'type').targets).toEqual(['p.Model']); // cast
    expect(ref(o, 20, 'Model', 'type').targets).toEqual(['p.Model']); // X.class
    // tip değişkeni ve JDK tipleri dönmez; repo içinde olmayan (silinmiş?) tip soluk (boş hedef)
    expect(o?.refs.some((x) => x.name === 'T')).toBe(false);
    expect(o?.refs.some((x) => ['List', 'String', 'Runnable', 'Object', 'Class'].includes(x.name))).toBe(false);
    expect(ref(o, 22, 'Missing', 'type').targets).toEqual([]);
    // anonim sınıf içindeki çağrı ve alan başlatıcısı
    expect(ref(o, 24, 'charge').targets).toEqual(['p.Api#charge(int)']);
    expect(ref(o, 7, 'create')).toMatchObject({ kind: 'call', targets: ['p.Model#create()'] });
    expect(ref(o, 7, 'Model', 'type').targets).toEqual(['p.Model']);
    // iç tipteki çağrı (Local.x → Service yapıcısı ve run)
    expect(ref(o, 29, 'Service', 'constructor').targets).toEqual(['p.Service#Service(Api)']);
    expect(ref(o, 29, 'run').targets).toEqual(['p.Service#run(List)']);
    // çözülemeyen JDK çağrıları da boş hedefle döner (soluk)
    // bildirimler: tip + üyeler + iç tip, durumlar
    const decl = (id: string) => o?.decls.find((d) => d.id === id);
    expect(decl('p.Service')).toMatchObject({ kind: 'class', nameLine: 5, nameStartCol: 13, nameEndCol: 20, status: 'signatureChanged' }); // <T> eklendi
    expect(decl('p.Service#model')).toMatchObject({ kind: 'field', ownerTypeId: 'p.Service', status: 'added', nameLine: 7 });
    expect(decl('p.Service#run(List)')).toMatchObject({ kind: 'method', status: 'modified', range: { startLine: 13, endLine: 26 } });
    expect(decl('p.Service#Service(Api)')?.status).toBeUndefined();
    expect(decl('p.Service.Local')).toMatchObject({ kind: 'class', nameLine: 28 });
    expect(decl('p.Service.Local#x()')).toMatchObject({ ownerTypeId: 'p.Service.Local' });
    // sıralı
    const order = (o?.refs ?? []).map((r) => r.line * 1000 + r.startCol);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('diff dışı dosya ve iç tipteki alıcısız çağrı', async () => {
    const cs = scenario();
    const { nav } = await analyze(cs);
    const o = await nav.outline(cs, `${P}/Util.java`, 'new');
    expect(o).toMatchObject({ inDiff: false, packageName: 'p' });
    expect(ref(o, 7, 'helper').targets).toEqual(['p.Util#helper()']);
    expect(o?.decls.map((d) => d.id)).toEqual(['p.Util', 'p.Util#helper()', 'p.Util.Deep', 'p.Util.Deep#d()']);
    expect(o?.decls.every((d) => d.status === undefined)).toBe(true);
    // değişmeyen dosyanın eski tarafı = head
    const old = await nav.outline(cs, `${P}/Util.java`, 'old');
    expect(old).toMatchObject({ side: 'old', inDiff: false });
    expect(ref(old, 7, 'helper').targets).toEqual(['p.Util#helper()']);
  });

  it('old taraf: eski model, silinen üye durumu, bağlam satırında hedef çözülür, silinen satırda boş', async () => {
    const cs = scenario();
    const { nav } = await analyze(cs);
    const o = await nav.outline(cs, `${P}/Service.java`, 'old');
    expect(o).toMatchObject({ side: 'old', inDiff: true });
    expect(o?.decls.find((d) => d.id === 'p.Service#legacy()')).toMatchObject({ status: 'removed', nameLine: 16 });
    // api.charge(1): eski satır 13 → yeni satır 14 (değişmeyen bağlam)
    expect(ref(o, 13, 'charge').targets).toEqual(['p.Api#charge(int)']);
    // silinen legacy() içindeki çağrı: head'de yok
    expect(ref(o, 17, 'charge').targets).toEqual([]);
    // tip referansları head indeksine göre çözülür
    expect(ref(o, 6, 'Api', 'type').targets).toEqual(['p.Api']);
    // silinmiş dosya: old var, new 404
    const gone = await nav.outline(cs, `${P}/Gone.java`, 'old');
    expect(gone?.decls.find((d) => d.id === 'p.Gone')).toMatchObject({ status: 'removed' });
    expect(await nav.outline(cs, `${P}/Gone.java`, 'new')).toBeUndefined();
  });

  it('Java olmayan dosya boş outline; olmayan dosya undefined (404)', async () => {
    const cs = scenario();
    const { nav } = await analyze(cs);
    expect(await nav.outline(cs, 'README.md', 'new')).toEqual({ path: 'README.md', side: 'new', inDiff: false, decls: [], refs: [] });
    expect(await nav.outline(cs, 'yok.md', 'new')).toBeUndefined();
    expect(await nav.outline(cs, `${P}/Yok.java`, 'new')).toBeUndefined();
  });

  it('artefaktlar (ayrıştırma önbelleği modelleri) değiştirilmez', async () => {
    const cs = scenario();
    const { nav, artifacts } = await analyze(cs);
    const snap = () => JSON.stringify([...artifacts.index.files.values()].map((m) => ({ ...m, typeRefPositions: m.typeRefPositions ? Array.from(m.typeRefPositions.data) : null })));
    const before = snap();
    await nav.outline(cs, `${P}/Service.java`, 'new');
    await nav.outline(cs, `${P}/Service.java`, 'old');
    await nav.outline(cs, `${P}/Util.java`, 'new');
    nav.locate('p.Util#helper()');
    expect(snap()).toBe(before);
  });
});

describe('locate', () => {
  it('değişen, silinen (old), diff dışı, tip, iç tip, $anon, bulunamayan', async () => {
    const cs = scenario();
    const { nav } = await analyze(cs);
    expect(nav.locate('p.Service#run(List)')).toMatchObject({
      kind: 'method',
      name: 'run',
      path: `${P}/Service.java`,
      side: 'new',
      inDiff: true,
      typeId: 'p.Service',
      range: { startLine: 13, endLine: 26 },
    });
    expect(nav.locate('p.Service#legacy()')).toMatchObject({ side: 'old', path: `${P}/Service.java`, inDiff: true, range: { startLine: 16, endLine: 18 } });
    expect(nav.locate('p.Gone')).toMatchObject({ kind: 'class', side: 'old', path: `${P}/Gone.java`, inDiff: true });
    expect(nav.locate('p.Gone#bye()')).toMatchObject({ side: 'old', typeId: 'p.Gone' });
    expect(nav.locate('p.Util#helper()')).toMatchObject({
      kind: 'method',
      side: 'new',
      path: `${P}/Util.java`,
      inDiff: false,
      signature: 'public static void helper()',
      range: { startLine: 4, endLine: 4 },
    });
    expect(nav.locate('p.Model.Inner')).toMatchObject({ kind: 'class', typeId: 'p.Model.Inner', range: { startLine: 6, endLine: 6 } });
    expect(nav.locate('p.Model')?.signature).toBe('public class Model');
    const anon = nav.locate('p.Service#run(List)$anon1#run()');
    expect(anon).toMatchObject({ id: 'p.Service#run(List)$anon1#run()', kind: 'method', name: 'run', range: { startLine: 13, endLine: 26 } });
    expect(nav.locate('p.Yok')).toBeUndefined();
    expect(nav.locate('p.Util#yok()')).toBeUndefined();
  });

  it("çift FQN: '@kök' sonekli id'ler outline ve locate'te ReviewModel ile aynı", async () => {
    const dup = (n: number) => `package p;\n\npublic class Dup {\n    public int v() { return ${n}; }\n\n    int w() { return v(); }\n}\n`;
    const cs = createMemoryChangeSet({
      old: { 'a/src/p/Dup.java': dup(1), 'b/src/p/Dup.java': dup(1) },
      new: { 'a/src/p/Dup.java': dup(2), 'b/src/p/Dup.java': dup(3) },
    });
    const { model, nav } = await analyze(cs);
    const typeIds = model.types.map((t) => t.id).sort();
    expect(typeIds).toEqual(['p.Dup@a/src', 'p.Dup@b/src']);
    const o = await nav.outline(cs, 'b/src/p/Dup.java', 'new');
    expect(o?.decls.map((d) => d.id)).toEqual(['p.Dup@b/src', 'p.Dup@b/src#v()', 'p.Dup@b/src#w()']);
    expect(o?.decls.find((d) => d.id === 'p.Dup@b/src#v()')?.status).toBe('modified');
    expect(ref(o, 6, 'v').targets).toEqual(['p.Dup@b/src#v()']);
    expect(nav.locate('p.Dup@a/src#v()')).toMatchObject({ path: 'a/src/p/Dup.java', side: 'new', typeId: 'p.Dup@a/src' });
    expect(nav.locate('p.Dup@b/src')).toMatchObject({ path: 'b/src/p/Dup.java', kind: 'class' });
    // ReviewModel'deki tüm id'ler bulunur
    for (const t of model.types) {
      expect(nav.locate(t.id)?.typeId).toBe(t.id);
      for (const m of t.members) expect(nav.locate(m.id)?.typeId).toBe(t.id);
    }
  });

  it('buildArtifacts, buildReview ile aynı id ve hedefleri üretir', async () => {
    const cs = scenario();
    const { model, nav } = await analyze(cs);
    const nav2 = new ReviewNavigator(model, await buildArtifacts(cs));
    expect(await nav2.outline(cs, `${P}/Service.java`, 'new')).toEqual(await nav.outline(cs, `${P}/Service.java`, 'new'));
    expect(nav2.locate('p.Util#helper()')).toEqual(nav.locate('p.Util#helper()'));
  });
});

describe('oldToNewLineMapper', () => {
  it('hunk öncesi/arası/sonrası kaydırma; silinen satır undefined', () => {
    const oldText = Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n');
    const lines = oldText.split('\n');
    const newLines = [...lines];
    newLines.splice(4, 1); // l5 silindi
    newLines.splice(19, 0, 'x1', 'x2'); // l21 öncesine 2 satır
    const hunks = computeHunks('a', 'a', `${oldText}\n`, `${newLines.join('\n')}\n`);
    const map = oldToNewLineMapper({ hunks } as Parameters<typeof oldToNewLineMapper>[0]);
    expect(map(1)).toBe(1);
    expect(map(5)).toBeUndefined();
    expect(map(6)).toBe(5);
    expect(map(15)).toBe(14);
    expect(map(21)).toBe(22);
    expect(map(30)).toBe(31);
  });
});

const FIXTURE = join(process.cwd(), 'fixtures/sample-repo');

describe.skipIf(!existsSync(join(FIXTURE, '.git')))('fikstür (sample-repo main...feature/ai-refactor)', () => {
  it('PlaceOrderService: paymentGateway.charge → PaymentGateway#charge(Money,String); AbstractNotifier.notify → deliver', async () => {
    const cs = await createGitTestChangeSet(FIXTURE, 'main', 'feature/ai-refactor');
    const { nav } = await analyze(cs);
    const o = await nav.outline(cs, 'src/main/java/com/acme/shop/application/service/PlaceOrderService.java', 'new');
    const charge = o?.refs.find((r) => r.name === 'charge');
    expect(charge).toMatchObject({ kind: 'call', targets: ['com.acme.shop.application.port.out.PaymentGateway#charge(Money,String)'], confidence: 'exact' });
    const n = await nav.outline(cs, 'src/main/java/com/acme/shop/adapter/out/notification/AbstractNotifier.java', 'new');
    const notify = n?.decls.find((d) => d.name === 'notify');
    const deliver = n?.refs.find((r) => r.name === 'deliver' && r.kind === 'call');
    expect(notify && deliver && deliver.line >= notify.range.startLine && deliver.line <= notify.range.endLine).toBe(true);
    expect(deliver?.targets).toEqual(['com.acme.shop.adapter.out.notification.AbstractNotifier#deliver(Customer,String)']);
    // diff dışı sembol
    expect(nav.locate('com.acme.shop.adapter.out.payment.PaymentReference')).toMatchObject({ inDiff: false, side: 'new' });
  });
});

describe('performans', () => {
  it('5000 satırlık dosyada outline < 200 ms (artefakt sıcak)', async () => {
    const body: string[] = ['package big;', '', 'import java.util.List;', '', 'public class Big {'];
    let n = 0;
    while (body.length < 4990) {
      body.push(`    public int m${n}(List<String> xs, Big other) {`);
      body.push(`        Helper h = new Helper();`);
      body.push(`        int a = other.m${Math.max(0, n - 1)}(xs, this) + Helper.twice(${n});`);
      body.push(`        return h.value(a) + m${Math.max(0, n - 1)}(xs, other);`);
      body.push('    }');
      n++;
    }
    body.push('}');
    const big = `${body.join('\n')}\n`;
    const helper = 'package big;\n\npublic class Helper {\n    public static int twice(int x) { return 2 * x; }\n    public int value(int a) { return a; }\n}\n';
    const cs = createMemoryChangeSet({
      old: { 'src/big/Big.java': big.replace('public class Big', 'class Big') },
      new: { 'src/big/Big.java': big },
      extraNewFiles: { 'src/big/Helper.java': helper },
    });
    const { nav } = await analyze(cs);
    const times: number[] = [];
    let o: FileOutline | undefined;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      o = await nav.outline(cs, 'src/big/Big.java', 'new');
      times.push(performance.now() - t0);
    }
    const oldT0 = performance.now();
    await nav.outline(cs, 'src/big/Big.java', 'old');
    const oldMs = performance.now() - oldT0;
    console.log(`outline 5000 satır: ${times.map((t) => t.toFixed(1)).join(' / ')} ms (new), ${oldMs.toFixed(1)} ms (old), ${o?.refs.length} ref`);
    expect(o?.refs.length).toBeGreaterThan(7000);
    expect(o?.refs.find((r) => r.name === 'twice')?.targets).toEqual(['big.Helper#twice(int)']);
    expect(Math.min(...times)).toBeLessThan(200);
    expect(times[0]).toBeLessThan(1000);
  });
});

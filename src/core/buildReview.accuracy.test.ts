/**
 * Doğruluk uçtan uca testleri: gerçek ayrıştırıcı + RepoIndex ile bellek içi ChangeSet'ler.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReviewModel } from '../shared/types.js';
import { buildReview, SLIM_MEMBERS_FILE_LIMIT } from './buildReview.js';
import { createGitTestChangeSet } from './testing/gitChangeSet.js';
import { createMemoryChangeSet } from './testing/memoryChangeSet.js';
import { modelInconsistencies } from './testing/modelConsistency.js';

const member = (model: ReviewModel, id: string) => model.types.flatMap((t) => t.members).find((m) => m.id === id);
const staleFindings = (model: ReviewModel) => model.findings.filter((f) => f.id.startsWith('callers:removed-with-callers:'));

describe('bayat çağrı yanlış pozitifleri', () => {
  it('iç sınıfın aynı adlı metoduna giden çağrı ve örtük varsayılan yapıcı bayat sayılmaz; gerçek kırık çağrı error', async () => {
    const MAP = (withCreate: boolean) => `package p;

public class ImmutableMap {
${withCreate ? '    public Object createEntrySet() { return null; }\n' : ''}    public int size() { return 0; }

    static class IteratorBased extends Base {
        public Object createEntrySet() { return null; }
        Object entries() { return createEntrySet(); }
    }
}
`;
    const BAG = (withCtor: boolean) => `package p;

public class Bag {
${withCtor ? '    public Bag() {}\n' : ''}    public int n() { return 1; }
}
`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/p/ImmutableMap.java': MAP(true), 'src/main/java/p/Bag.java': BAG(true) },
      new: { 'src/main/java/p/ImmutableMap.java': MAP(false), 'src/main/java/p/Bag.java': BAG(false) },
      extraNewFiles: {
        'src/main/java/p/Base.java': 'package p;\npublic class Base {}\n',
        'src/main/java/p/User.java': `package p;

public class User {
    Bag make() { return new Bag(); }
    Object broken(ImmutableMap m) { return m.createEntrySet(); }
}
`,
      },
    });
    const model = await buildReview(cs);
    expect(staleFindings(model).map((f) => f.title)).toEqual(['Silinmiş/değişmiş ama hâlâ çağrılıyor: ImmutableMap.createEntrySet']);
    const f = staleFindings(model)[0];
    expect(f.severity).toBe('error');
    expect(f.message).toContain('User.java:5');
    expect(f.message).not.toContain('ImmutableMap.java:');
    expect(member(model, 'p.Bag#Bag()')?.risk.reasons.map((r) => r.code)).not.toContain('removed-with-callers');
  });

  it('alıcısı çözülemeyen (name-only) çağrılar yalnız tek özet bilgi bulgusu üretir', async () => {
    const S = (withName: boolean) => `package p;\npublic class Shape {\n${withName ? '    public String label() { return ""; }\n' : ''}    public int k() { return 1; }\n}\n`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/p/Shape.java': S(true) },
      new: { 'src/main/java/p/Shape.java': S(false) },
      extraNewFiles: {
        'src/main/java/q/Other.java': 'package q;\npublic class Other {\n    public String label() { return "x"; }\n}\n',
        'src/main/java/q/Third.java': 'package q;\npublic class Third {\n    public String label() { return "y"; }\n}\n',
        'src/main/java/q/Use.java': 'package q;\npublic class Use {\n    String a() { return get().label(); }\n    private static Object get() { return null; }\n}\n',
      },
    });
    const model = await buildReview(cs);
    expect(staleFindings(model)).toEqual([]);
    expect(member(model, 'p.Shape#label()')?.risk.level).not.toBe('critical');
  });
});

describe('kalan overload argüman tipiyle uyuşmuyor', () => {
  it('indexOf(CharSequence,int,int) → 4 parametre; char argümanlı eski çağrı likely bayat (warning)', async () => {
    const U = (four: boolean) => `package p;

public class CharSequenceUtils {
    static int indexOf(CharSequence cs, CharSequence searchSeq, int start) { return 0; }
    static int indexOf(CharSequence cs, int searchChar, int start${four ? ', int end' : ''}) { return 1; }
}
`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/p/CharSequenceUtils.java': U(false) },
      new: { 'src/main/java/p/CharSequenceUtils.java': U(true) },
      extraNewFiles: {
        'src/main/java/p/StringUtils.java': `package p;

public class StringUtils {
    static int a(CharSequence seq) { return CharSequenceUtils.indexOf(seq, 'c', 0); }
    static int b(CharSequence seq, CharSequence sub) { return CharSequenceUtils.indexOf(seq, sub, 0); }
}
`,
      },
    });
    const model = await buildReview(cs);
    const f = staleFindings(model);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warning');
    expect(f[0].message).toContain('StringUtils.java:4');
    expect(f[0].message).not.toContain('StringUtils.java:5');
  });
});

describe('çift FQN (çok kaynak köklü repo)', () => {
  it('her kökün tipi ayrı id alır; modeldeki tüm referanslar tutarlı', async () => {
    const P = (body: string) => `package com.g.base;

public final class Preconditions {
    public static <T> T checkNotNull(T ref) {
        ${body}
    }
}
`;
    const USER = (pkg: string) => `package com.g.${pkg};

import com.g.base.Preconditions;

public class User {
    Object go(Object o) { return Preconditions.checkNotNull(o); }
}
`;
    const cs = createMemoryChangeSet({
      old: { 'guava/src/com/g/base/Preconditions.java': P('return ref;'), 'android/guava/src/com/g/base/Preconditions.java': P('return ref;') },
      new: {
        'guava/src/com/g/base/Preconditions.java': P('if (ref == null) throw new NullPointerException();\n        return ref;'),
        'android/guava/src/com/g/base/Preconditions.java': P('if (ref == null) throw new NullPointerException();\n        return ref;'),
      },
      extraNewFiles: { 'guava/src/com/g/a/User.java': USER('a'), 'android/guava/src/com/g/a/User.java': USER('a') },
    });
    const model = await buildReview(cs);
    const ids = model.types.map((t) => t.id).sort();
    expect(ids).toEqual(['com.g.base.Preconditions@android/guava/src', 'com.g.base.Preconditions@guava/src']);
    const m = member(model, 'com.g.base.Preconditions@android/guava/src#checkNotNull(T)');
    expect(m?.status).toBe('modified');
    expect(model.files.find((f) => f.path.startsWith('android/'))?.typeIds).toEqual(['com.g.base.Preconditions@android/guava/src']);
    expect(modelInconsistencies(model)).toEqual([]);
    // Çağıranlar kendi kökündeki varyanta bağlanır (çapraz bağlama yok)
    for (const t of model.types) {
      const root = t.id.slice(t.id.indexOf('@') + 1);
      for (const mc of t.members) for (const c of mc.callers) expect(c.file.startsWith(`${root}/`), `${mc.id} ← ${c.file}`).toBe(true);
    }
  });
});

describe('javax → jakarta', () => {
  it('import hedefi değişen dosya kozmetik değil, ayrıntı ve orta risk taşır', async () => {
    const OWNER = (ns: string) => `package app.model;

import ${ns}.persistence.Entity;
import ${ns}.persistence.Table;

@Entity
@Table(name = "owners")
public class Owner {
    private String name;
}
`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/app/model/Owner.java': OWNER('javax') },
      new: { 'src/main/java/app/model/Owner.java': OWNER('jakarta') },
    });
    const model = await buildReview(cs);
    const f = model.files[0];
    expect(f.cosmeticOnly).toBe(false);
    expect(f.risk.level).toBe('medium');
    const t = model.types[0];
    expect(t.details).toContain('import hedefi değişti: javax.persistence.Entity → jakarta.persistence.Entity');
    expect(t.risk.reasons.map((r) => r.code)).toContain('import-retarget');
    expect(modelInconsistencies(model)).toEqual([]);
  });

  it('yalnız import sıralaması kozmetik kalır', async () => {
    const A = (imports: string) => `package app;\n\n${imports}\n\npublic class A {\n    List<String> x;\n    Map<String, String> y;\n}\n`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/app/A.java': A('import java.util.List;\nimport java.util.Map;') },
      new: { 'src/main/java/app/A.java': A('import java.util.Map;\nimport java.util.List;') },
    });
    const model = await buildReview(cs);
    expect(model.files[0].cosmeticOnly).toBe(true);
  });
});

describe('git yeniden adlandırması', () => {
  it('renamed dosyada tek üst düzey tip removed+added değil renamed olur', async () => {
    const OLD = `package p;

public interface BitMapProducer {
    boolean forEachBitMap(java.util.function.LongPredicate p);
    default long[] asBitMapArray() { return new long[0]; }
}
`;
    const NEW = `package p;

public interface BitMapExtractor {
    boolean processBitMaps(java.util.function.LongPredicate p);
    default long[] asBitMapArray() { return new long[1]; }
    static BitMapExtractor fromArray(long... a) { return null; }
}
`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/p/BitMapProducer.java': OLD },
      new: { 'src/main/java/p/BitMapExtractor.java': NEW },
      renames: { 'src/main/java/p/BitMapExtractor.java': 'src/main/java/p/BitMapProducer.java' },
    });
    const model = await buildReview(cs);
    expect(model.types.map((t) => [t.id, t.status])).toEqual([['p.BitMapExtractor', 'renamed']]);
    expect(model.types[0].oldId).toBe('p.BitMapProducer');
  });
});

describe('küçük maddeler — buildReview', () => {
  it('yalnız biçim değişikliği olan dosyada "önceden de vardı" mimari bulgusu üretilmez', async () => {
    const SVC = (ws: string) => `package app.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    @Autowired
    private Repo repo;

    public int count() {${ws}return 1;
    }
}
`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/app/service/OrderService.java': SVC('\n        ') },
      new: { 'src/main/java/app/service/OrderService.java': SVC('\n\n        ') },
      extraNewFiles: { 'src/main/java/app/service/Repo.java': 'package app.service;\npublic interface Repo {}\n' },
    });
    const model = await buildReview(cs);
    expect(model.files[0].cosmeticOnly).toBe(true);
    expect(model.findings.filter((f) => f.category === 'architecture')).toEqual([]);
  });

  it('blobId verilirse ayrıştırma önbelleği kullanılır; sonuç aynı', async () => {
    const mk = () => {
      const cs = createMemoryChangeSet({
        old: { 'src/main/java/p/A.java': 'package p;\npublic class A { int a() { return 1; } }\n' },
        new: { 'src/main/java/p/A.java': 'package p;\npublic class A { int a() { return 2; } }\n' },
        extraNewFiles: { 'src/main/java/p/B.java': 'package p;\npublic class B { int b(A x) { return x.a(); } }\n' },
      });
      const calls: string[] = [];
      cs.blobId = async (side, path) => {
        calls.push(`${side}:${path}`);
        return `${side}-${path}-sha`;
      };
      return { cs, calls };
    };
    const first = mk();
    const m1 = await buildReview(first.cs);
    expect(first.calls).toEqual(expect.arrayContaining(['old:src/main/java/p/A.java', 'new:src/main/java/p/A.java', 'new:src/main/java/p/B.java']));
    const second = mk();
    const m2 = await buildReview(second.cs);
    expect(member(m2, 'p.A#a()')?.callers.map((c) => c.fromId)).toEqual(member(m1, 'p.A#a()')?.callers.map((c) => c.fromId));
    expect(member(m2, 'p.A#a()')?.callers.map((c) => c.fromId)).toEqual(['p.B#b(A)']);
  });

  it('Java değişikliği yoksa repo indeksi kurulmaz', async () => {
    const msgs: string[] = [];
    const cs = createMemoryChangeSet({
      old: { 'README.md': 'a\n' },
      new: { 'README.md': 'b\n' },
      extraNewFiles: { 'src/main/java/p/A.java': 'package p;\npublic class A {}\n' },
    });
    const model = await buildReview(cs, { onProgress: (m) => msgs.push(m) });
    expect(msgs.some((m) => m.startsWith('Repo indeksi') || m.startsWith('Çağrı grafiği'))).toBe(false);
    expect(model.files).toHaveLength(1);
  });

  it('indeks uyarısı okunamayan/hatalı dosyaların ilk 10 adını listeler', async () => {
    const extra: Record<string, string> = { 'src/main/java/p/B.java': 'package p;\npublic class B { void x( { }\n' };
    for (let i = 0; i < 12; i++) extra[`src/main/java/q/E${String(i).padStart(2, '0')}.java`] = `package q;\npublic class E${i} { int f( }\n`;
    const cs = createMemoryChangeSet({
      old: { 'src/main/java/p/A.java': 'package p;\npublic class A { int a() { return 1; } }\n' },
      new: { 'src/main/java/p/A.java': 'package p;\npublic class A { int a() { return 2; } }\n' },
      extraNewFiles: extra,
    });
    const model = await buildReview(cs);
    const w = model.warnings.find((x) => x.startsWith('Repo indeksinde'));
    expect(w).toBeDefined();
    expect(w).toContain('src/main/java/p/B.java');
    expect(w).toContain('ayrıştırma hatası içeren 13 dosya');
    expect(w).toContain('ve 3 dosya daha');
  });

  it(`${SLIM_MEMBERS_FILE_LIMIT} değişen dosyayı aşan diff'te değişmeyen üyeler iskelet`, { timeout: 120_000 }, async () => {
    const old: Record<string, string> = {};
    const nw: Record<string, string> = {};
    const base = 'package p;\npublic class Base { public void hook() {} }\n';
    for (let i = 0; i <= SLIM_MEMBERS_FILE_LIMIT; i++) {
      const src = (v: number) => `package p;\npublic class C${i} extends Base {\n    @Override public void hook() {}\n    int f() { return ${v}; }\n}\n`;
      old[`src/main/java/p/C${i}.java`] = src(0);
      nw[`src/main/java/p/C${i}.java`] = src(1);
    }
    const model = await buildReview(createMemoryChangeSet({ old, new: nw, extraNewFiles: { 'src/main/java/p/Base.java': base } }));
    const hook = member(model, 'p.C0#hook()');
    expect(hook?.status).toBe('unchanged');
    expect(hook?.overrides).toEqual([]);
    expect(hook?.signature).toContain('hook');
    expect(member(model, 'p.C0#f()')?.status).toBe('modified');
  });
});

const FIXTURE = join(process.cwd(), 'fixtures', 'sample-repo');
const hasFixture = existsSync(join(FIXTURE, '.git'));

describe.skipIf(!hasFixture)('fikstür — tur 3 tutarlılık', () => {
  it('ai-refactor ve small-fix modelleri iç tutarlı; legacyPad kırık çağrısı error kalır', { timeout: 60_000 }, async () => {
    for (const head of ['feature/ai-refactor', 'feature/small-fix']) {
      const model = await buildReview(await createGitTestChangeSet(FIXTURE, 'main', head));
      expect(modelInconsistencies(model), head).toEqual([]);
      if (head === 'feature/ai-refactor') {
        const f = staleFindings(model).find((x) => x.id.includes('legacyPad'));
        expect(f?.severity).toBe('error');
      }
    }
  });
});

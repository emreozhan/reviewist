/**
 * YALNIZCA TEST İÇİN: büyük repoyu taklit eden sentetik ChangeSet.
 * Modüller × paketler (domain, port, servis, adapter, test); servisler port arayüzlerini çağırır, adapter'lar implemente eder,
 * testler servisleri çağırır. Değişen dosyalarda: port imzası değişir (parametre eklenir), servis gövdeleri değişir,
 * bazı dosyalar yalnızca biçimsel değişir.
 */
import type { ChangeSet } from '../../shared/types.js';
import { createMemoryChangeSet } from './memoryChangeSet.js';

export interface SyntheticOptions {
  /** Repo indeksindeki toplam .java dosyası (yaklaşık). */
  indexFiles: number;
  /** Değişen dosya sayısı (yaklaşık; indexFiles'tan seçilir). */
  changedFiles: number;
}

interface Unit {
  path: string;
  kind: 'port' | 'adapter' | 'service' | 'domain' | 'test';
  i: number;
  render(changed: boolean): string;
}

function methods(prefix: string, count: number, body: (k: number) => string): string {
  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    out.push(`
    /** ${prefix} işlemi ${k}. */
    public int ${prefix}${k}(int a, java.util.List<String> names) {
${body(k)}
    }`);
  }
  return out.join('\n');
}

function makeUnits(total: number): Unit[] {
  // 5 dosyalık bloklar: port, adapter, service, domain, test
  const blocks = Math.max(1, Math.floor(total / 5));
  const units: Unit[] = [];
  for (let i = 0; i < blocks; i++) {
    const m = `m${i % 40}`;
    const base = `com.acme.${m}`;
    const dir = `module-${i % 8}/src/main/java/com/acme/${m}`;
    const tdir = `module-${i % 8}/src/test/java/com/acme/${m}`;
    const nextDomain = `Entity${(i + 1) % blocks}`;
    const nextBase = `com.acme.m${((i + 1) % blocks) % 40}`;
    units.push({
      path: `${dir}/application/port/out/Store${i}Port.java`,
      kind: 'port',
      i,
      render: (changed) => `package ${base}.application.port.out;

import ${base}.domain.Entity${i};

public interface Store${i}Port {
    Entity${i} load(String id${changed ? ', boolean strict' : ''});
    void save(Entity${i} entity);
    int count();
}
`,
    });
    units.push({
      path: `${dir}/adapter/out/persistence/Store${i}Adapter.java`,
      kind: 'adapter',
      i,
      render: (changed) => `package ${base}.adapter.out.persistence;

import ${base}.application.port.out.Store${i}Port;
import ${base}.domain.Entity${i};
import java.util.HashMap;
import java.util.Map;

public class Store${i}Adapter implements Store${i}Port {
    private final Map<String, Entity${i}> data = new HashMap<>();

    @Override
    public Entity${i} load(String id${changed ? ', boolean strict' : ''}) {
        Entity${i} e = data.get(id);
        ${changed ? 'if (strict && e == null) throw new IllegalStateException(id);' : ''}
        return e;
    }

    @Override
    public void save(Entity${i} entity) {
        data.put(entity.getId(), entity);
    }

    @Override
    public int count() {
        return data.size();
    }
}
`,
    });
    units.push({
      path: `${dir}/application/service/Process${i}Service.java`,
      kind: 'service',
      i,
      render: (changed) => `package ${base}.application.service;

import ${base}.application.port.out.Store${i}Port;
import ${base}.domain.Entity${i};
import ${nextBase}.domain.${nextDomain};

public class Process${i}Service {
    private final Store${i}Port store;

    public Process${i}Service(Store${i}Port store) {
        this.store = store;
    }

    public Entity${i} handle(String id) {
        Entity${i} e = store.load(id${changed ? ', true' : ''});
        if (e == null) {
            return null;
        }
        e.touch(${changed ? '2' : '1'});
        store.save(e);
        return e;
    }

    public ${nextDomain} link(${nextDomain} other) {
        return other;
    }
${methods('step', 6, (k) => `        int sum = a;
        for (String n : names) {
            if (n != null && !n.isEmpty()) {
                sum += n.length() * ${changed && k === 0 ? 3 : 2};
            }
        }
        return sum > ${k} ? sum : store.count();`)}
}
`,
    });
    units.push({
      path: `${dir}/domain/Entity${i}.java`,
      kind: 'domain',
      i,
      render: (changed) => `package ${base}.domain;

public class Entity${i} {
    private final String id;
    private int version;

    public Entity${i}(String id) {
        this.id = id;
    }

    public String getId() {
        return id;
    }

    public void touch(int delta) {
${changed ? '        // sürüm artışı\n        this.version += delta;' : '        this.version += delta;'}
    }

    public int getVersion() {
        return version;
    }
}
`,
    });
    units.push({
      path: `${tdir}/application/service/Process${i}ServiceTest.java`,
      kind: 'test',
      i,
      render: (changed) => `package ${base}.application.service;

import ${base}.adapter.out.persistence.Store${i}Adapter;
import ${base}.domain.Entity${i};
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertNull;

class Process${i}ServiceTest {
    @Test
    void shouldReturnNull_whenMissing() {
        Process${i}Service s = new Process${i}Service(new Store${i}Adapter());
        assertNull(s.handle("${changed ? 'yok' : 'x'}"));
    }
}
`,
    });
  }
  return units;
}

/**
 * Sentetik büyük değişiklik kümesi. Değişen dosyalar blok başlarından seçilir (port + adapter + servis + domain + test birlikte),
 * böylece imza değişikliği, implementasyon, çağıran ve test ilişkileri gerçekçi biçimde oluşur.
 */
export function createSyntheticChangeSet(opts: SyntheticOptions): { cs: ChangeSet; changedPaths: string[]; totalJava: number } {
  const units = makeUnits(opts.indexFiles);
  const oldFiles: Record<string, string> = {};
  const newFiles: Record<string, string> = {};
  const extra: Record<string, string> = {};
  const changedBlocks = Math.max(1, Math.ceil(opts.changedFiles / 5));
  const blocks = Math.max(1, Math.floor(opts.indexFiles / 5));
  const stride = Math.max(1, Math.floor(blocks / changedBlocks));
  const changedBlockIds = new Set<number>();
  for (let b = 0; b < blocks && changedBlockIds.size < changedBlocks; b += stride) changedBlockIds.add(b);
  const changedPaths: string[] = [];
  for (const u of units) {
    if (changedBlockIds.has(u.i)) {
      oldFiles[u.path] = u.render(false);
      newFiles[u.path] = u.render(true);
      changedPaths.push(u.path);
    } else {
      extra[u.path] = u.render(false);
    }
  }
  const cs = createMemoryChangeSet({ old: oldFiles, new: newFiles, extraNewFiles: extra, info: { title: 'sentetik' } });
  return { cs, changedPaths, totalJava: units.length };
}

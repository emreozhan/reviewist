import { describe, expect, it } from 'vitest';
import type { JavaFileModel, JavaType } from '../java/model.js';
import { jFile, jMember, jType } from '../testing/builders.js';
import { checkArchitecture, type ArchitectureDeps } from './architecture.js';

const J = 'src/main/java/com/acme';

function deps(types: { t: JavaType; path: string }[]): ArchitectureDeps {
  const byFqn = new Map(types.map((x) => [x.t.fqn, x]));
  return {
    hexagonal: true,
    resolve: (name, file: JavaFileModel) => {
      const imp = file.imports.find((i) => i.name.endsWith(`.${name}`));
      if (imp) return imp.name;
      for (const fqn of byFqn.keys()) if (fqn.endsWith(`.${name}`)) return fqn;
      return undefined;
    },
    getType: (fqn) => byFqn.get(fqn)?.t,
    pathOfType: (fqn) => byFqn.get(fqn)?.path,
  };
}

const rules = (fs: { id: string }[]) => fs.map((f) => f.id.split(':')[1]);

describe('checkArchitecture', () => {
  it('domain → framework ve dış katman bağımlılığı (yeni: error)', () => {
    const order = jType({ fqn: 'com.acme.domain.model.Order', annotations: ['@Component'] });
    const newModel = jFile(`${J}/domain/model/Order.java`, [order], {
      imports: ['org.springframework.stereotype.Component', 'com.acme.application.port.in.PlaceOrderCommand'],
    });
    const oldModel = jFile(`${J}/domain/model/Order.java`, [jType({ fqn: 'com.acme.domain.model.Order' })]);
    const cmd = jType({ fqn: 'com.acme.application.port.in.PlaceOrderCommand', kind: 'record' });
    const out = checkArchitecture(newModel.path, newModel, oldModel, undefined, deps([{ t: cmd, path: `${J}/application/port/in/PlaceOrderCommand.java` }]));
    expect(rules(out).sort()).toEqual(['domain-framework', 'domain-outer']);
    expect(out.every((f) => f.severity === 'error')).toBe(true);
    expect(out[0].file).toBe(newModel.path);
  });

  it('eski sürümde de varsa info', () => {
    const t = jType({ fqn: 'com.acme.domain.Order' });
    const m = jFile(`${J}/domain/Order.java`, [t], { imports: ['jakarta.persistence.Entity'] });
    const out = checkArchitecture(m.path, m, m, undefined, deps([]));
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('info');
    expect(out[0].title).toContain('önceden de vardı');
  });

  it('port içinde framework anotasyonu, adapter\'lar arası bağımlılık', () => {
    const port = jType({ fqn: 'com.acme.application.port.out.Repo', kind: 'interface', annotations: ['@Repository'] });
    const pm = jFile(`${J}/application/port/out/Repo.java`, [port]);
    expect(rules(checkArchitecture(pm.path, pm, undefined, undefined, deps([])))).toEqual(['port-framework']);

    const a = jType({ fqn: 'com.acme.adapter.out.persistence.JpaAdapter' });
    const am = jFile(`${J}/adapter/out/persistence/JpaAdapter.java`, [a], { imports: ['com.acme.adapter.out.messaging.KafkaPublisher', 'com.acme.adapter.out.persistence.OrderEntity'] });
    const out = checkArchitecture(am.path, am, undefined, undefined, deps([]));
    expect(rules(out)).toEqual(['adapter-cross']);
    expect(out[0].message).toContain('KafkaPublisher');
  });

  it('controller: alan enjeksiyonu, servis sınıfı enjeksiyonu, @Transactional', () => {
    const svc = jType({ fqn: 'com.acme.application.service.PlaceOrderService', interfaces: ['PlaceOrderUseCase'] });
    const ctrl = jType({
      fqn: 'com.acme.adapter.in.web.OrderController',
      annotations: ['@RestController'],
      members: [
        jMember({ ownerFqn: 'com.acme.adapter.in.web.OrderController', name: 'svc', kind: 'field', visibility: 'private', fieldType: 'PlaceOrderService', annotations: ['@Autowired'], range: { startLine: 30, endLine: 31 } }),
        jMember({ ownerFqn: 'com.acme.adapter.in.web.OrderController', name: 'post', annotations: ['@Transactional', '@PostMapping'] }),
      ],
    });
    const m = jFile(`${J}/adapter/in/web/OrderController.java`, [ctrl], { imports: ['com.acme.application.service.PlaceOrderService'] });
    const out = checkArchitecture(m.path, m, undefined, undefined, deps([{ t: svc, path: `${J}/application/service/PlaceOrderService.java` }]));
    expect(rules(out).sort()).toEqual(['controller-service', 'field-injection', 'transactional-layer']);
    expect(out.find((f) => f.id.includes('field-injection'))?.line).toBe(30);
    expect(out.find((f) => f.id.includes('controller-service'))?.message).toContain('PlaceOrderUseCase');
  });

  it('application servisindeki @Transactional ihlal değil; hexagonal olmayan repoda import kuralları çalışmaz', () => {
    const s = jType({ fqn: 'com.acme.application.service.Cancel', annotations: ['@Service'], members: [jMember({ ownerFqn: 'com.acme.application.service.Cancel', name: 'run', annotations: ['@Transactional'] })] });
    const m = jFile(`${J}/application/service/Cancel.java`, [s], { imports: ['org.springframework.transaction.annotation.Transactional'] });
    expect(checkArchitecture(m.path, m, undefined, undefined, deps([]))).toEqual([]);
    const d = jFile(`${J}/domain/Order.java`, [jType({ fqn: 'com.acme.domain.Order' })], { imports: ['jakarta.persistence.Entity'] });
    expect(checkArchitecture(d.path, d, undefined, undefined, { ...deps([]), hexagonal: false })).toEqual([]);
  });
});

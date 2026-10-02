import { describe, expect, it } from 'vitest';
import { createModuleResolver, detectLanguage, detectLayer, isHexagonalRepo, isTestPath } from './layers.js';

const J = 'src/main/java/';

describe('detectLayer', () => {
  it('hexagonal paketleri öncelikli tanır', () => {
    expect(detectLayer({ path: `${J}com/acme/order/domain/model/Order.java`, packageName: 'com.acme.order.domain.model' })).toBe('domain');
    expect(detectLayer({ path: 'x.java', packageName: 'com.acme.order.application.port.in' })).toBe('port');
    expect(detectLayer({ path: 'x.java', packageName: 'com.acme.order.application.port.out' })).toBe('port');
    expect(detectLayer({ path: 'x.java', packageName: 'com.acme.order.application.service' })).toBe('application');
    expect(detectLayer({ path: 'x.java', packageName: 'com.acme.order.usecase' })).toBe('application');
    expect(detectLayer({ path: 'x.java', packageName: 'com.acme.adapter.in.web', annotations: ['@RestController'] })).toBe('adapter-in');
    expect(detectLayer({ path: 'x.java', packageName: 'com.acme.adapter.out.persistence', annotations: ['@Repository'] })).toBe('adapter-out');
    expect(detectLayer({ path: 'x.java', packageName: 'com.acme.adapters.web' })).toBe('adapter-in');
  });

  it('paket yoksa yol segmentlerini kullanır', () => {
    expect(detectLayer({ path: `${J}com/acme/domain/Order.java` })).toBe('domain');
    expect(detectLayer({ path: `${J}com/acme/adapter/out/persistence/OrderJpa.java` })).toBe('adapter-out');
  });

  it('Spring anotasyonlarını ve üst tipleri tanır', () => {
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme', annotations: ['@RestController'] })).toBe('controller');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme', annotations: ['@Service'] })).toBe('service');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme', annotations: ['@Repository'] })).toBe('repository');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme', typeKind: 'interface', superTypes: ['JpaRepository'] })).toBe('repository');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme', annotations: ['@Entity', '@Table(name = "x")'] })).toBe('model');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme', typeKind: 'record', typeName: 'OrderDto' })).toBe('model');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme', annotations: ['@Configuration'] })).toBe('config');
  });

  it('zayıf segmentler', () => {
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme.web' })).toBe('adapter-in');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme.persistence' })).toBe('adapter-out');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme.service' })).toBe('service');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme.service', hexagonal: true })).toBe('application');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme.common' })).toBe('util');
    expect(detectLayer({ path: 'A.java', packageName: 'com.acme', typeName: 'StringUtils' })).toBe('util');
  });

  it('test, build, resource ve diğerleri', () => {
    expect(detectLayer({ path: 'src/test/java/com/acme/domain/OrderTest.java', packageName: 'com.acme.domain' })).toBe('test');
    expect(detectLayer({ path: 'lib/FooIT.java' })).toBe('test');
    expect(detectLayer({ path: 'pom.xml' })).toBe('build');
    expect(detectLayer({ path: 'core/build.gradle.kts' })).toBe('build');
    expect(detectLayer({ path: 'src/main/resources/application.yml' })).toBe('resource');
    expect(detectLayer({ path: 'db/migration/V1__init.sql' })).toBe('resource');
    expect(detectLayer({ path: 'README.md' })).toBe('other');
  });
});

describe('yardımcılar', () => {
  it('dil', () => {
    expect(detectLanguage('a/B.java')).toBe('java');
    expect(detectLanguage('build.gradle.kts')).toBe('gradle');
    expect(detectLanguage('x.yaml')).toBe('yaml');
    expect(detectLanguage('x.bin')).toBe('other');
  });
  it('test yolu', () => {
    expect(isTestPath('src/test/java/A.java')).toBe(true);
    expect(isTestPath('src/main/java/TestData.java')).toBe(true);
    expect(isTestPath('src/main/java/Testing.java')).toBe(false);
    expect(isTestPath('src/main/java/Contest.java')).toBe(false);
  });
  it('hexagonal repo', () => {
    expect(isHexagonalRepo(['src/main/java/com/acme/adapter/in/web/A.java'])).toBe(true);
    expect(isHexagonalRepo(['src/main/java/com/acme/service/A.java'])).toBe(false);
  });
  it('modül çözücü', () => {
    const single = createModuleResolver(['pom.xml', 'src/main/java/A.java']);
    expect(single('src/main/java/A.java')).toBeUndefined();
    const multi = createModuleResolver(['pom.xml', 'core/pom.xml', 'web/build.gradle.kts']);
    expect(multi('core/src/main/java/A.java')).toBe('core');
    expect(multi('web/src/B.java')).toBe('web');
    expect(multi('README.md')).toBe('.');
  });
});

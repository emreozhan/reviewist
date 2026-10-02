/**
 * Hexagonal mimari ve Spring kuralları (Harry java-dev skill'i):
 *  - domain hiçbir dış katmana ve framework'e (Spring/JPA/Jackson) bağımlı olamaz
 *  - application/port içinde framework anotasyonu yasak; application adapter'a bağımlı olamaz
 *  - adapter'lar birbirini bilemez
 *  - controller yalnızca inbound port'u çağırır; application service'i doğrudan enjekte etmez
 *  - @Autowired alan enjeksiyonu yasak (constructor injection)
 *  - @Transactional controller veya repository'de kullanılmaz
 * Kural yeni kodda ihlal ediliyorsa warning/error; eski sürümde de varsa info ("önceden de vardı").
 */
import type { Finding, Layer } from '../../shared/types.js';
import type { JavaFileModel, JavaMember, JavaType } from '../java/model.js';
import { detectLayer } from './layers.js';
import { annotationName, packageOf, simpleTypeName } from './util.js';

export const FRAMEWORK_PREFIXES = ['org.springframework', 'jakarta.persistence', 'javax.persistence', 'com.fasterxml', 'org.hibernate'];

const FRAMEWORK_ANNOTATIONS = new Set([
  'Service', 'Component', 'Repository', 'Controller', 'RestController', 'Configuration', 'Bean', 'Autowired', 'Value', 'Transactional',
  'Entity', 'Table', 'Column', 'Id', 'GeneratedValue', 'OneToMany', 'ManyToOne', 'OneToOne', 'ManyToMany', 'JoinColumn', 'Embeddable', 'Embedded',
  'JsonProperty', 'JsonIgnore', 'JsonInclude', 'JsonFormat', 'JsonCreator', 'Qualifier', 'Primary', 'Async', 'Cacheable', 'Scheduled', 'EventListener',
]);

const SPRING_DATA = new Set(['JpaRepository', 'CrudRepository', 'PagingAndSortingRepository', 'ListCrudRepository', 'ListPagingAndSortingRepository', 'MongoRepository', 'ReactiveCrudRepository', 'Repository', 'JpaSpecificationExecutor']);

export interface ArchitectureDeps {
  hexagonal: boolean;
  /** Tip adını FQN'e çözer (indeks). */
  resolve: (name: string, file: JavaFileModel, type?: JavaType) => string | undefined;
  getType: (fqn: string) => JavaType | undefined;
  /** Repo tipinin dosya yolu (katman tespiti için). */
  pathOfType?: (fqn: string) => string | undefined;
}

interface Violation {
  key: string;
  rule: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  line?: number;
  symbolIds: string[];
}

const RULE_TITLES: Record<string, string> = {
  'domain-framework': 'Domain framework\'e bağımlı',
  'domain-outer': 'Domain dış katmana bağımlı',
  'port-framework': 'Port içinde framework bağımlılığı',
  'application-adapter': 'Application adapter\'a bağımlı',
  'adapter-cross': 'Adapter\'lar birbirine bağımlı',
  'controller-service': 'Controller application service\'i doğrudan enjekte ediyor',
  'field-injection': '@Autowired alan enjeksiyonu',
  'transactional-layer': '@Transactional yanlış katmanda',
};

function typeLayer(t: JavaType, model: JavaFileModel, path: string, hexagonal: boolean): Layer {
  return detectLayer({
    path,
    packageName: model.packageName,
    annotations: t.annotations,
    superTypes: [...(t.superclass ? [t.superclass] : []), ...t.interfaces],
    typeKind: t.kind,
    typeName: t.name,
    hexagonal,
  });
}

/** İçe aktarılan adın katmanı: indeksteki tipin dosyasından, yoksa paket segmentlerinden. */
function importLayer(name: string, deps: ArchitectureDeps): Layer {
  const t = deps.getType(name);
  const path = deps.pathOfType?.(name);
  if (t && path) {
    return detectLayer({ path, packageName: packageOf(name), annotations: t.annotations, typeKind: t.kind, typeName: t.name, hexagonal: deps.hexagonal });
  }
  return detectLayer({ path: 'X.java', packageName: /^[A-Z]/.test(simpleTypeName(name)) ? packageOf(name) : name, hexagonal: deps.hexagonal });
}

/** 'com.acme.adapter.out.persistence.X' → 'com.acme.adapter.out.persistence' (adapter + 2 segment). */
function adapterIdentity(pkg: string): string | undefined {
  const segs = pkg.split('.');
  const i = segs.findIndex((s) => s === 'adapter' || s === 'adapters');
  if (i < 0) return undefined;
  return segs.slice(0, Math.min(segs.length, i + 3)).join('.');
}

function hasAnn(list: readonly string[], ...names: string[]): boolean {
  return list.some((a) => names.includes(annotationName(a)));
}

function isController(t: JavaType): boolean {
  return hasAnn(t.annotations, 'RestController', 'Controller');
}

function isRepository(t: JavaType, layer: Layer): boolean {
  if (hasAnn(t.annotations, 'Repository')) return true;
  if (layer === 'repository') return true;
  return [...(t.superclass ? [t.superclass] : []), ...t.interfaces].some((s) => SPRING_DATA.has(simpleTypeName(s)));
}

function isFramework(name: string): boolean {
  return FRAMEWORK_PREFIXES.some((p) => name === p || name.startsWith(`${p}.`));
}

function memberLine(m: JavaMember): number {
  return m.range.startLine;
}

function collect(model: JavaFileModel, path: string, deps: ArchitectureDeps): Violation[] {
  const out: Violation[] = [];
  const topTypes = model.types.filter((t) => !t.outerFqn);
  if (topTypes.length === 0) return out;
  const fileLayer = typeLayer(topTypes[0], model, path, deps.hexagonal);
  const primary = topTypes[0].fqn;
  const push = (rule: string, severity: Violation['severity'], detail: string, message: string, line: number | undefined, symbolIds: string[]) =>
    out.push({ key: `${rule}:${symbolIds[0] ?? primary}:${detail}`, rule, severity, title: RULE_TITLES[rule], message, line, symbolIds });

  // Import tabanlı kurallar (yalnızca hexagonal düzende anlamlı)
  if (deps.hexagonal) {
    for (const imp of model.imports) {
      const name = imp.static ? packageOf(imp.name) : imp.name;
      if (fileLayer === 'domain') {
        if (isFramework(name)) {
          push('domain-framework', 'error', imp.name, `Domain katmanı framework'e bağımlı: '${imp.name}' import ediliyor. Domain saf Java kalmalı; framework ayrıntısı adapter'a taşınmalı.`, imp.line, [primary]);
          continue;
        }
        const l = importLayer(name, deps);
        if (l === 'application' || l === 'port' || l === 'adapter-in' || l === 'adapter-out' || l === 'controller' || l === 'repository' || l === 'config') {
          push('domain-outer', 'error', imp.name, `Domain katmanı dış katmana (${l}) bağımlı: '${imp.name}'. Bağımlılık yönü içeri doğru olmalı (adapter → application → domain).`, imp.line, [primary]);
        }
      } else if (fileLayer === 'port') {
        if (isFramework(name)) {
          push('port-framework', 'warning', imp.name, `Port arayüzü framework'e bağımlı: '${imp.name}'. Port'lar saf Java olmalı.`, imp.line, [primary]);
        }
      }
      if (fileLayer === 'application' || fileLayer === 'port') {
        const l = importLayer(name, deps);
        if (l === 'adapter-in' || l === 'adapter-out') {
          push('application-adapter', 'warning', imp.name, `${fileLayer === 'port' ? 'Port' : 'Application katmanı'} adapter'a (${l}) bağımlı: '${imp.name}'. Dış dünyaya port arayüzü üzerinden erişilmeli.`, imp.line, [primary]);
        }
      }
      if (fileLayer === 'adapter-in' || fileLayer === 'adapter-out') {
        const l = importLayer(name, deps);
        if (l === 'adapter-in' || l === 'adapter-out') {
          const mine = adapterIdentity(model.packageName);
          const theirs = adapterIdentity(packageOf(name));
          const different = mine && theirs ? mine !== theirs : l !== fileLayer;
          if (different) {
            push('adapter-cross', 'warning', imp.name, `Adapter başka bir adapter'ı import ediyor: '${imp.name}' (${l}). Adapter'lar birbirini bilmemeli; iletişim application katmanı üzerinden olmalı.`, imp.line, [primary]);
          }
        }
      }
    }
  }

  for (const t of model.types) {
    const layer = typeLayer(t, model, path, deps.hexagonal);
    // Port içinde framework anotasyonu
    if (deps.hexagonal && layer === 'port') {
      const anns = [...t.annotations.map((a) => ({ a, id: t.fqn, line: t.range.startLine })), ...t.members.flatMap((m) => m.annotations.map((a) => ({ a, id: m.id, line: memberLine(m) })))];
      for (const { a, id, line } of anns) {
        if (FRAMEWORK_ANNOTATIONS.has(annotationName(a))) {
          push('port-framework', 'warning', `@${annotationName(a)}:${id}`, `Port içinde framework anotasyonu: ${a}. Port'lar saf Java arayüzleri olmalı.`, line, [id]);
        }
      }
    }
    if (deps.hexagonal && layer === 'domain') {
      // Framework importu zaten raporlandıysa aynı sorunun anotasyon kanıtı ayrı bulgu yapılmaz.
      const importReported = out.some((v) => v.rule === 'domain-framework');
      for (const a of importReported ? [] : t.annotations) {
        if (FRAMEWORK_ANNOTATIONS.has(annotationName(a))) {
          push('domain-framework', 'error', `@${annotationName(a)}`, `Domain tipi framework anotasyonu taşıyor: ${a}. JPA entity / Spring bean domain modeli olarak kullanılmamalı.`, t.range.startLine, [t.fqn]);
        }
      }
    }

    // @Autowired alan enjeksiyonu
    for (const m of t.members) {
      if (m.kind === 'field' && hasAnn(m.annotations, 'Autowired', 'Inject')) {
        push('field-injection', 'warning', m.name, `${t.name}.${m.name} alanına @Autowired ile enjeksiyon yapılıyor. Constructor injection kullanılmalı (test edilebilirlik, final alanlar).`, memberLine(m), [m.id]);
      }
    }

    // @Transactional controller / repository'de
    const controller = isController(t);
    const repository = !controller && isRepository(t, layer);
    if (controller || repository) {
      const where = controller ? 'controller' : 'repository';
      const typeTx = t.annotations.find((a) => annotationName(a) === 'Transactional');
      const springDataInterface = t.kind === 'interface' && [...(t.superclass ? [t.superclass] : []), ...t.interfaces].some((x) => SPRING_DATA.has(simpleTypeName(x)));
      if (typeTx && springDataInterface && /readOnly\s*=\s*true/.test(typeTx)) {
        push('transactional-layer', 'info', t.fqn, `${t.name} Spring Data repository arayüzü sınıf düzeyinde salt okunur @Transactional kullanıyor (readOnly = true); yaygın bir kalıp.`, t.range.startLine, [t.fqn]);
      } else if (typeTx) {
        push('transactional-layer', 'warning', t.fqn, `${t.name} (${where}) sınıf düzeyinde @Transactional kullanıyor. Transaction sınırı application service (use case) seviyesinde olmalı.`, t.range.startLine, [t.fqn]);
      }
      // Spring Data repository arayüzünde salt okunur işlem (readOnly = true) yaygın ve zararsız bir kalıptır: bilgi.
      for (const m of t.members) {
        const tx = m.annotations.find((a) => annotationName(a) === 'Transactional');
        if (!tx) continue;
        if (springDataInterface && /readOnly\s*=\s*true/.test(tx)) {
          push('transactional-layer', 'info', m.id, `${t.name}.${m.name} Spring Data repository arayüzünde salt okunur @Transactional kullanıyor (readOnly = true); yaygın bir kalıp, transaction sınırı yine de servis katmanında tanımlanmalı.`, memberLine(m), [m.id]);
          continue;
        }
        push('transactional-layer', 'warning', m.id, `${t.name}.${m.name} (${where}) @Transactional kullanıyor. Transaction sınırı application service (use case) seviyesinde olmalı.`, memberLine(m), [m.id]);
      }
    }

    // Controller application service'i doğrudan enjekte ediyor
    if (controller || (layer === 'adapter-in' && /Controller$|Resource$|Endpoint$/.test(t.name))) {
      const deps2: { typeName: string; line: number; id: string; via: string }[] = [];
      for (const m of t.members) {
        if (m.kind === 'field' && !m.modifiers.includes('static') && m.fieldType) deps2.push({ typeName: m.fieldType, line: memberLine(m), id: m.id, via: `alan ${m.name}` });
        if (m.kind === 'constructor') for (const p of m.params) deps2.push({ typeName: p.type, line: memberLine(m), id: m.id, via: `yapıcı parametresi ${p.name}` });
      }
      const seen = new Set<string>();
      for (const d of deps2) {
        const raw = d.typeName.replace(/<.*$/, '').trim();
        const fqn = deps.resolve(raw, model, t);
        if (!fqn || seen.has(fqn)) continue;
        const dt = deps.getType(fqn);
        if (!dt || dt.kind !== 'class') continue;
        const dl = importLayer(fqn, deps);
        const serviceLike = dl === 'application' || dl === 'service' || (dl === 'other' && /Service(Impl)?$|UseCaseImpl$|Interactor$/.test(dt.name));
        if (!serviceLike) continue;
        const implementsPort = dt.interfaces.length > 0;
        if (!deps.hexagonal && !implementsPort) continue;
        seen.add(fqn);
        push(
          'controller-service',
          'warning',
          fqn,
          `${t.name}, ${d.via} üzerinden somut sınıf ${dt.name}'i enjekte ediyor. Controller yalnızca inbound port (use case arayüzü${dt.interfaces.length ? `: ${dt.interfaces.map(simpleTypeName).join(', ')}` : ''}) üzerinden konuşmalı.`,
          d.line,
          [t.fqn, fqn],
        );
      }
    }
  }
  return out;
}

/**
 * Değişen bir dosya için mimari bulgular. Yeni ihlaller warning/error; eski sürümde de bulunan ihlaller info.
 */
export function checkArchitecture(path: string, newModel: JavaFileModel, oldModel: JavaFileModel | undefined, oldPath: string | undefined, deps: ArchitectureDeps): Finding[] {
  const now = collect(newModel, path, deps);
  const before = oldModel ? new Set(collect(oldModel, oldPath ?? path, deps).map((v) => v.key)) : new Set<string>();
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const v of now) {
    if (seen.has(v.key)) continue;
    seen.add(v.key);
    const existed = before.has(v.key);
    out.push({
      id: `architecture:${v.key}`,
      severity: existed ? 'info' : v.severity,
      category: 'architecture',
      title: existed ? `${v.title} (önceden de vardı)` : v.title,
      message: existed ? `${v.message} Bu ihlal önceden de vardı; bu değişiklikle gelmedi.` : v.message,
      file: path,
      line: v.line,
      symbolIds: v.symbolIds,
    });
  }
  return out;
}

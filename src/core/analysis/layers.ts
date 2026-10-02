/**
 * Katman, dil, test ve modül tespiti.
 *
 * Öncelik sırası (detectLayer):
 *  1. test yolu/adı → 'test'
 *  2. pom.xml / build.gradle(.kts) / settings.gradle(.kts) / gradle.properties → 'build'
 *  3. src/main/resources → 'resource'
 *  4. Hexagonal paket segmentleri (öncelikli): port/ports → 'port'; adapter(s)[/in|/out] → 'adapter-in' / 'adapter-out';
 *     application/usecase(s) → 'application'; domain → 'domain'
 *  5. Hexagonal repoda zayıf segmentler: web/rest/api/controller → adapter-in; persistence/infrastructure/client/messaging → adapter-out;
 *     service(s) → application
 *  6. Spring anotasyonları / üst tipler: @RestController/@Controller → controller, @Service → service,
 *     @Repository veya JpaRepository/CrudRepository türevi → repository, @Entity/@Embeddable/DTO record → model, @Configuration → config
 *  7. Zayıf segmentler (hexagonal olmayan): web/rest/api/controller → adapter-in; persistence/infrastructure/client/messaging → adapter-out;
 *     service → service; model/entity/dto → model; config → config; util/common/helper → util
 *  8. Uzantı: .sql/.yml/.properties → resource; diğer → other
 */
import type { FileChange, Layer, TypeKind } from '../../shared/types.js';
import { annotationName, basename, dirname, simpleTypeName } from './util.js';

export type Language = FileChange['language'];

export interface LayerInput {
  path: string;
  packageName?: string;
  /** Tipin anotasyonları ('@Service', '@Entity' ...). */
  annotations?: string[];
  /** extends + implements adları (basit ya da FQN). */
  superTypes?: string[];
  typeKind?: TypeKind;
  typeName?: string;
  /** Repo hexagonal paket düzeni kullanıyor mu (bkz. isHexagonalRepo). */
  hexagonal?: boolean;
}

const BUILD_FILES = new Set(['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties']);
const MODULE_FILES = new Set(['pom.xml', 'build.gradle', 'build.gradle.kts']);
/**
 * Test kodu dizinleri: src/test*, src/it, src/integration-test, src/testFixtures; test kütüphaneleri (`*-testlib/`,
 * `testlib/`) ve test modülleri (`*-tests/`, ör. guava-tests).
 */
const TEST_DIR_RE = /(^|\/)(src\/(test[\w-]*|it|integrationTest|integration-test)\/|[\w.-]*-testlib\/|testlib\/|[\w.-]+-tests\/)/;
const TEST_NAME_RE = /(^Test[A-Z]\w*|\w+(Test|Tests|IT|ITCase|TestCase|Tester|Spec))\.(java|kt|groovy|scala)$/;
const SPRING_DATA_REPOS = new Set([
  'JpaRepository',
  'CrudRepository',
  'PagingAndSortingRepository',
  'ListCrudRepository',
  'ListPagingAndSortingRepository',
  'ReactiveCrudRepository',
  'MongoRepository',
  'JpaSpecificationExecutor',
  'Repository',
]);

export function detectLanguage(path: string): Language {
  const name = basename(path).toLowerCase();
  if (name.endsWith('.gradle') || name.endsWith('.gradle.kts')) return 'gradle';
  if (name.endsWith('.java')) return 'java';
  if (name.endsWith('.kt') || name.endsWith('.kts')) return 'kotlin';
  if (name.endsWith('.xml')) return 'xml';
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml';
  if (name.endsWith('.properties')) return 'properties';
  if (name.endsWith('.sql')) return 'sql';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  return 'other';
}

export function isTestPath(path: string): boolean {
  return TEST_DIR_RE.test(path) || TEST_NAME_RE.test(basename(path));
}

export function isBuildFile(path: string): boolean {
  return BUILD_FILES.has(basename(path));
}

/** Yol veya paketten küçük harfli segmentler. */
function segmentsOf(input: LayerInput): string[] {
  if (input.packageName) return input.packageName.toLowerCase().split('.');
  const dir = dirname(input.path);
  const javaRoot = /(?:^|\/)src\/(?:main|test)\/(?:java|kotlin)\//.exec(dir + '/');
  const rel = javaRoot ? (dir + '/').slice(javaRoot.index + javaRoot[0].length) : dir;
  return rel.toLowerCase().split('/').filter(Boolean);
}

function hexagonalLayer(segs: string[]): Layer | undefined {
  if (segs.includes('port') || segs.includes('ports')) return 'port';
  const ai = segs.findIndex((s) => s === 'adapter' || s === 'adapters');
  if (ai >= 0) {
    const rest = segs.slice(ai + 1);
    if (rest[0] === 'in' || rest[0] === 'inbound' || rest[0] === 'primary') return 'adapter-in';
    if (rest[0] === 'out' || rest[0] === 'outbound' || rest[0] === 'secondary') return 'adapter-out';
    if (rest.some((s) => WEAK_IN.has(s))) return 'adapter-in';
    return 'adapter-out';
  }
  if (segs.includes('application') || segs.includes('usecase') || segs.includes('usecases')) return 'application';
  if (segs.includes('domain')) return 'domain';
  return undefined;
}

const WEAK_IN = new Set(['web', 'rest', 'api', 'controller', 'controllers', 'graphql', 'grpc']);
const WEAK_OUT = new Set(['persistence', 'infrastructure', 'infra', 'client', 'clients', 'messaging', 'jpa', 'kafka']);

function springLayer(input: LayerInput): Layer | undefined {
  const anns = new Set((input.annotations ?? []).map(annotationName));
  if (anns.has('RestController') || anns.has('Controller') || anns.has('ControllerAdvice') || anns.has('RestControllerAdvice')) return 'controller';
  if (anns.has('Repository')) return 'repository';
  const supers = (input.superTypes ?? []).map(simpleTypeName);
  if (input.typeKind === 'interface' && supers.some((s) => SPRING_DATA_REPOS.has(s))) return 'repository';
  if (anns.has('Service')) return 'service';
  if (anns.has('Entity') || anns.has('Embeddable') || anns.has('MappedSuperclass') || anns.has('Document')) return 'model';
  if (anns.has('Configuration') || anns.has('SpringBootApplication') || anns.has('ConfigurationProperties') || anns.has('AutoConfiguration')) return 'config';
  if (input.typeKind === 'record' && input.typeName && /(Dto|DTO|Request|Response|Command|Query|Result|Event)$/.test(input.typeName)) return 'model';
  return undefined;
}

function weakLayer(segs: string[], hexagonal: boolean): Layer | undefined {
  if (segs.some((s) => WEAK_IN.has(s))) return 'adapter-in';
  if (segs.some((s) => WEAK_OUT.has(s))) return 'adapter-out';
  if (segs.includes('service') || segs.includes('services')) return hexagonal ? 'application' : 'service';
  if (segs.includes('repository') || segs.includes('repositories') || segs.includes('dao')) return hexagonal ? 'adapter-out' : 'repository';
  if (segs.includes('model') || segs.includes('entity') || segs.includes('entities') || segs.includes('dto')) return 'model';
  if (segs.includes('config') || segs.includes('configuration')) return 'config';
  if (segs.some((s) => s === 'util' || s === 'utils' || s === 'common' || s === 'helper' || s === 'helpers' || s === 'support')) return 'util';
  return undefined;
}

export function detectLayer(input: LayerInput): Layer {
  const path = input.path;
  if (isTestPath(path)) return 'test';
  if (isBuildFile(path)) return 'build';
  if (/(^|\/)src\/main\/resources\//.test(path)) return 'resource';
  const lang = detectLanguage(path);
  if (lang === 'java' || lang === 'kotlin' || input.packageName) {
    const segs = segmentsOf(input);
    const hex = hexagonalLayer(segs);
    if (hex) return hex;
    if (input.hexagonal) {
      const weak = weakLayer(segs, true);
      if (weak && weak !== 'util' && weak !== 'model' && weak !== 'config') return weak;
    }
    const spring = springLayer(input);
    if (spring) return spring;
    const weak = weakLayer(segs, input.hexagonal ?? false);
    if (weak) return weak;
    if (/Util(s)?$|Helper(s)?$/.test(input.typeName ?? '')) return 'util';
    return 'other';
  }
  if (lang === 'sql' || lang === 'yaml' || lang === 'properties') return 'resource';
  return 'other';
}

/** Yol listesinde hexagonal paket düzeni var mı: adapter/port segmenti veya domain + application birlikte. */
export function isHexagonalRepo(paths: Iterable<string>): boolean {
  let domain = false;
  let application = false;
  for (const p of paths) {
    const segs = p.toLowerCase().split('/');
    if (segs.includes('adapter') || segs.includes('adapters') || segs.includes('port') || segs.includes('ports')) return true;
    if (segs.includes('domain')) domain = true;
    if (segs.includes('application') || segs.includes('usecase') || segs.includes('usecases')) application = true;
    if (domain && application) return true;
  }
  return false;
}

/**
 * En yakın modül dizini (pom.xml / build.gradle(.kts) içeren). Repo yalnızca kökte build dosyası içeriyorsa
 * (tek modüllü) undefined döner; çok modüllüde kök '.' olarak gösterilir.
 */
export function createModuleResolver(allPaths: Iterable<string>): (path: string) => string | undefined {
  const moduleDirs = new Set<string>();
  for (const p of allPaths) if (MODULE_FILES.has(basename(p))) moduleDirs.add(dirname(p));
  const multi = moduleDirs.size > 1 || (moduleDirs.size === 1 && !moduleDirs.has(''));
  return (path: string) => {
    if (!multi) return undefined;
    let dir = dirname(path);
    while (true) {
      if (moduleDirs.has(dir)) return dir === '' ? '.' : dir;
      if (dir === '') return undefined;
      dir = dirname(dir);
    }
  };
}

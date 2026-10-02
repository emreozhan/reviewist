/**
 * Risk puanlama. Her kural bir RiskReason (code, Türkçe message, weight) üretir; skor = ağırlıklar toplamı (0-100).
 * Seviye: <20 low, <45 medium, <70 high, ≥70 critical. Test kodunda skor yarıya iner. Kozmetik/değişmemiş: 0.
 *
 * Ağırlıklar RISK_WEIGHTS içinde belgelidir; ölçek mantığı:
 *  - Tek başına derleme/çalışma zamanı kırılması üretebilecek durumlar (silinmiş ama çağrılan) → critical (≥70)
 *  - Sözleşme/kalıtım yoluyla birden çok sınıfa yayılan değişiklikler → high (45-69)
 *  - Anlamı sessizce değiştiren (anotasyon, eşzamanlılık, SQL, equals) → medium-high
 *  - Gövde değişikliği, büyüklük, karmaşıklık → low-medium katkı
 */
import type { CallRef, FileChange, MemberChange, RiskInfo, RiskReason, TypeKind } from '../../shared/types.js';
import type { JavaMember, JavaType, MemberDiff, TypeDiff, Visibility } from '../java/model.js';
import { annotationName, basename, countMatches, extractAnnotations, makeRisk, simpleTypeName } from './util.js';

export const RISK_WEIGHTS = {
  /** Silinmiş/yeniden adlandırılmış/arity'si değişmiş üye head'de hâlâ eski haliyle çağrılıyor: taban + çağrı başına (en fazla 4) */
  removedWithCallers: 60,
  removedWithCallersPerCall: 5,
  /** Alt sınıflarda eski imzayla kalan metot artık override etmiyor */
  overrideBroken: 40,
  /** public üye imzası değişti / protected */
  publicApiSignature: 35,
  protectedApiSignature: 25,
  privateSignature: 5,
  /** public/protected üye silindi */
  publicApiRemoved: 35,
  privateRemoved: 3,
  publicApiRenamed: 30,
  moved: 15,
  /** Arayüz/soyut metot eklendi veya imzası değişti: taban + implementasyon başına (en fazla 5) */
  interfaceContract: 25,
  interfaceContractPerImpl: 5,
  /** default metot gövdesi değişti */
  interfaceDefault: 10,
  /** Override edilen metodun davranışı değişti: taban + alt sınıf başına (en fazla 5) */
  overriddenBehavior: 15,
  overriddenBehaviorPerSub: 5,
  /** Şablon metot (alt sınıf kancalarını çağıran) değişti: taban + alt tip başına (en fazla 5) */
  templateMethod: 20,
  templateMethodPerSub: 4,
  /** Diff dışında çağıran: taban + çağıran başına (en fazla 10) */
  callersOutside: 10,
  callersOutsidePer: 3,
  /** Yalnız 'likely' çağıranlardan gelen katkının tavanı */
  callersOutsideLikelyCap: 8,
  /** 'body-changed' + 'callers-outside-diff' birleşiminin tavanı (tek başına high üretmesin: < 45) */
  bodyWithCallersCap: 40,
  /** Anlam taşıyan anotasyonlar: grup ağırlıkları SEMANTIC_ANNOTATIONS'ta, toplam tavan */
  annotationCap: 40,
  equalityContract: 40,
  /** equals/hashCode/compareTo aynı alanlarla yeniden yazıldı */
  equalityRewrite: 15,
  equalsHashCodeMismatch: 15,
  toStringWithEquals: 10,
  concurrency: 20,
  staticMutable: 20,
  emptyCatch: 20,
  catchCountChanged: 8,
  genericThrow: 10,
  genericCatch: 8,
  printStackTrace: 10,
  systemOut: 5,
  sqlChange: 25,
  largeBody: 10,
  veryLargeBody: 15,
  complexity: 10,
  complexityCap: 20,
  nullChecksDecreased: 12,
  returnsNullAdded: 10,
  bodyChanged: 5,
  fieldInitializer: 8,
  addedPublic: 5,
  addedPrivate: 2,
  /** Tip düzeyi */
  typeRemovedReferenced: 60,
  typeRemoved: 35,
  typeRenamed: 30,
  superTypesChanged: 25,
  typeVisibilityNarrowed: 20,
  springBean: 15,
  /** Import hedefi değişti (aynı basit ad başka FQN'e): çerçeve/anlam taşıyan pakette orta, diğerlerinde düşük */
  importRetargetMeaningful: 25,
  importRetarget: 8,
  /** module-info requires/exports/opens/provides/uses değişikliği */
  moduleDescriptor: 25,
  packageInfo: 3,
  /** Java dışı */
  buildDependency: 30,
  buildOther: 20,
  configChange: 30,
  sqlMigration: 50,
  sqlMigrationDeleted: 60,
  otherFile: 3,
  riskyConfigValue: 20,
  /** Mimari ihlal (yeni): error / warning */
  architectureError: 25,
  architectureWarning: 20,
  /** Eklenen üyede anlam taşıyan anotasyon (sorgu/güvenlik/transaction ...) */
  addedSemanticAnnotationFactor: 0.5,
  unanalyzedJava: 15,
} as const;

/** Anlam taşıyan anotasyon grupları. */
export const SEMANTIC_ANNOTATIONS: ReadonlyArray<{ key: string; label: string; weight: number; names: readonly string[] }> = [
  { key: 'transaction', label: 'işlem (transaction) sınırı', weight: 25, names: ['Transactional'] },
  { key: 'async', label: 'asenkron çalışma', weight: 20, names: ['Async'] },
  { key: 'cache', label: 'önbellek', weight: 15, names: ['Cacheable', 'CacheEvict', 'CachePut', 'Caching'] },
  { key: 'scheduled', label: 'zamanlanmış görev', weight: 15, names: ['Scheduled', 'SchedulerLock'] },
  { key: 'lock', label: 'kilitleme', weight: 20, names: ['Lock', 'Version'] },
  {
    key: 'security',
    label: 'yetkilendirme',
    weight: 30,
    names: ['PreAuthorize', 'PostAuthorize', 'Secured', 'RolesAllowed', 'PermitAll', 'DenyAll', 'PreFilter', 'PostFilter'],
  },
  {
    key: 'jpa',
    label: 'JPA eşlemesi',
    weight: 20,
    names: [
      'Entity', 'Table', 'Column', 'Id', 'GeneratedValue', 'OneToMany', 'ManyToOne', 'OneToOne', 'ManyToMany', 'JoinColumn',
      'JoinTable', 'Embedded', 'EmbeddedId', 'Embeddable', 'Transient', 'Enumerated', 'Lob', 'MappedSuperclass',
      'ElementCollection', 'OrderBy', 'Inheritance', 'DiscriminatorColumn', 'Convert', 'Fetch', 'BatchSize',
    ],
  },
  {
    key: 'json',
    label: 'JSON serileştirme',
    weight: 20,
    names: ['JsonProperty', 'JsonIgnore', 'JsonIgnoreProperties', 'JsonInclude', 'JsonFormat', 'JsonAlias', 'JsonCreator', 'JsonValue', 'JsonSerialize', 'JsonDeserialize', 'JsonTypeInfo', 'JsonSubTypes'],
  },
  {
    key: 'http',
    label: 'HTTP uç noktası',
    weight: 25,
    names: ['RequestMapping', 'GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping', 'PathVariable', 'RequestParam', 'RequestBody', 'RequestHeader', 'ResponseStatus', 'ResponseBody', 'CrossOrigin'],
  },
  {
    key: 'validation',
    label: 'doğrulama kısıtı',
    weight: 15,
    names: ['Valid', 'Validated', 'NotNull', 'NotBlank', 'NotEmpty', 'Size', 'Min', 'Max', 'Pattern', 'Email', 'Positive', 'PositiveOrZero', 'Negative', 'NegativeOrZero', 'Past', 'PastOrPresent', 'Future', 'FutureOrPresent', 'DecimalMin', 'DecimalMax', 'Digits', 'AssertTrue', 'AssertFalse', 'Null'],
  },
  { key: 'query', label: 'sorgu', weight: 25, names: ['Query', 'Modifying', 'NamedQuery', 'NamedNativeQuery', 'NativeQuery', 'Procedure'] },
  { key: 'event', label: 'olay dinleyici', weight: 15, names: ['EventListener', 'TransactionalEventListener', 'KafkaListener', 'RabbitListener', 'JmsListener', 'SqsListener'] },
];

const ANNOTATION_GROUP_BY_NAME = new Map<string, (typeof SEMANTIC_ANNOTATIONS)[number]>();
for (const g of SEMANTIC_ANNOTATIONS) for (const n of g.names) ANNOTATION_GROUP_BY_NAME.set(n, g);

const SPRING_BEAN_ANNOTATIONS = new Set(['Service', 'Component', 'Repository', 'Controller', 'RestController', 'Configuration', 'Bean', 'Primary', 'Qualifier', 'Profile', 'ConditionalOnProperty', 'Scope']);

export interface AnnotationChange {
  key: string;
  label: string;
  weight: number;
  added: string[];
  removed: string[];
}

function annotationMultiset(text: string | undefined, declared: readonly string[]): Map<string, number> {
  const found = extractAnnotations(text ?? '');
  const names = new Set(found.map(annotationName));
  for (const d of declared) if (!names.has(annotationName(d))) found.push(`@${annotationName(d)}${d.slice(d.indexOf('(') >= 0 ? d.indexOf('(') : d.length).replace(/\s+/g, ' ')}`);
  const out = new Map<string, number>();
  for (const a of found) out.set(a, (out.get(a) ?? 0) + 1);
  return out;
}

/** İki metin/anotasyon listesi arasında anlam taşıyan anotasyon farkları. */
export function semanticAnnotationChanges(
  oldText: string | undefined,
  newText: string | undefined,
  oldDeclared: readonly string[] = [],
  newDeclared: readonly string[] = [],
  includeSpringBeans = false,
): AnnotationChange[] {
  const a = annotationMultiset(oldText, oldDeclared);
  const b = annotationMultiset(newText, newDeclared);
  const groups = new Map<string, AnnotationChange>();
  const touch = (ann: string, side: 'added' | 'removed', count: number) => {
    const name = annotationName(ann);
    let g = ANNOTATION_GROUP_BY_NAME.get(name);
    if (!g && includeSpringBeans && SPRING_BEAN_ANNOTATIONS.has(name)) {
      g = { key: 'spring-bean', label: 'Spring bean tanımı', weight: RISK_WEIGHTS.springBean, names: [] };
    }
    if (!g) return;
    let ch = groups.get(g.key);
    if (!ch) {
      ch = { key: g.key, label: g.label, weight: g.weight, added: [], removed: [] };
      groups.set(g.key, ch);
    }
    for (let i = 0; i < count; i++) ch[side].push(ann);
  };
  for (const [ann, n] of b) {
    const d = n - (a.get(ann) ?? 0);
    if (d > 0) touch(ann, 'added', d);
  }
  for (const [ann, n] of a) {
    const d = n - (b.get(ann) ?? 0);
    if (d > 0) touch(ann, 'removed', d);
  }
  return [...groups.values()];
}

export function describeAnnotationChange(ch: AnnotationChange): string {
  const removedNames = new Set(ch.removed.map(annotationName));
  const parts: string[] = [];
  const changed = ch.added.filter((x) => removedNames.has(annotationName(x)));
  for (const x of changed) {
    const before = ch.removed.find((r) => annotationName(r) === annotationName(x));
    parts.push(`${before} → ${x}`);
  }
  const changedNames = new Set(changed.map(annotationName));
  const added = ch.added.filter((x) => !changedNames.has(annotationName(x)));
  const removed = ch.removed.filter((x) => !changedNames.has(annotationName(x)));
  if (added.length) parts.push(`${added.join(', ')} eklendi`);
  if (removed.length) parts.push(`${removed.join(', ')} kaldırıldı`);
  return `Anlam taşıyan anotasyon değişti (${ch.label}): ${parts.join('; ')}`;
}

// ---------------------------------------------------------------------------
// Üye riski
// ---------------------------------------------------------------------------

export interface MemberRiskInput {
  md: MemberDiff;
  /** Sahip tip (head varsa head, yoksa eski). */
  ownerType?: JavaType;
  ownerKind: TypeKind;
  ownerVisibility: Visibility;
  /** Sahip tipin repo içindeki (geçişli) alt tip / implementasyon sayısı. */
  implementationCount: number;
  /** Diff dışındaki farklı çağıran sayısı ('exact' güvenli çağrılar). */
  outsideCallers: number;
  /** Diff dışındaki 'likely' güvenli farklı çağıran sayısı (yarım ağırlık, küçük tavan). name-only sayılmaz. */
  outsideLikelyCallers?: number;
  /**
   * Head'de hâlâ eski ad/arity ile yapılan çağrılar (silinmiş/yeniden adlandırılmış/arity'si değişmiş üyeler için).
   * 'exact' varsa tam ağırlık (error); yalnız 'likely' ise yarım ağırlık (warning); 'name-only' sayılmaz.
   */
  staleCalls: readonly CallRef[];
  /** Alt tiplerde eski imzayla kalıp @Override taşıyan ve artık hiçbir şeyi override etmeyen (derlenmez) metot id'leri. */
  brokenOverrides: readonly string[];
  /** Alt tiplerde eski imzayla kalıp @Override taşımayan, artık asıl bildirim olan metot id'leri (bilgi, risk 0). */
  orphanedOverrides?: readonly string[];
  /** Sahip tip bu diff'te eklendi (implementasyon sayısı anlamsız). */
  ownerAdded?: boolean;
  isTest: boolean;
  /** Aynı tipte kozmetik olmayan şekilde değişen üye adları (toString/equals ilişkisi için). */
  changedSiblingNames?: ReadonlySet<string>;
  /** Sahip tipte alt sınıflarca override edilen veya abstract olan metot adları (template method tespiti). */
  hookNames?: ReadonlySet<string>;
  /** Bu üyeye bağlı yeni mimari ihlaller. */
  architecture?: readonly ArchitectureIssue[];
}

export interface ArchitectureIssue {
  severity: 'warning' | 'error';
  title: string;
}

function addArchitecture(reasons: RiskReason[], issues: readonly ArchitectureIssue[] | undefined): void {
  if (!issues?.length) return;
  const worst = issues.some((i) => i.severity === 'error') ? 'error' : 'warning';
  const titles = [...new Set(issues.map((i) => i.title))];
  reasons.push({
    code: 'architecture-violation',
    message: `Mimari ihlal: ${titles.join('; ')}`,
    weight: worst === 'error' ? RISK_WEIGHTS.architectureError : RISK_WEIGHTS.architectureWarning,
  });
}

const CHANGED_STATUSES = new Set(['added', 'removed', 'modified', 'signatureChanged', 'renamed', 'moved']);

export function isSemanticChange(status: string): boolean {
  return CHANGED_STATUSES.has(status);
}

/** Çağıranları/override edenleri kırabilecek imza bayrakları. */
const BREAKING_FLAGS = new Set(['params', 'returnType', 'throws', 'visibility', 'typeParams', 'fieldType', 'modifiers']);

/**
 * 'signatureChanged' durumunun gerçekten kırıcı (parametre/dönüş/throws/görünürlük...) olup olmadığı.
 * Yalnızca anotasyon/javadoc farkıyla gelen 'signatureChanged' davranış değişikliği olarak ele alınır.
 */
export function isBreakingSignature(mc: Pick<MemberChange, 'status' | 'flags'>): boolean {
  if (mc.status !== 'signatureChanged') return false;
  if (mc.flags.length === 0) return true;
  return mc.flags.some((f) => BREAKING_FLAGS.has(f));
}

export function isApiVisible(vis: Visibility, ownerVis: Visibility, ownerKind: TypeKind): boolean {
  if (vis !== 'public' && vis !== 'protected') return false;
  return ownerKind === 'interface' || ownerVis === 'public' || ownerVis === 'protected';
}

function isAbstractMember(m: JavaMember | undefined, ownerKind: TypeKind): boolean {
  if (!m || m.kind !== 'method') return false;
  if (m.modifiers.includes('abstract')) return true;
  if (ownerKind === 'interface') return !m.modifiers.includes('default') && !m.modifiers.includes('static') && !m.modifiers.includes('private') && m.normalizedBody === '';
  return false;
}

const IDENT_RE = /[A-Za-z_$][\w$]*/g;

/** Metin içinde geçen, sahip tipin alanı olan adlar. */
function referencedFields(text: string, fields: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const m of text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ' ').matchAll(IDENT_RE)) {
    const id = m[0];
    if (fields.has(id)) out.add(id);
    // Erişimci çağrısı (getObject() / isEnabled()) ilgili alana referans sayılır.
    const acc = /^(?:get|is)([A-Z][\w$]*)$/.exec(id);
    if (acc) {
      const field = acc[1].charAt(0).toLowerCase() + acc[1].slice(1);
      if (fields.has(field)) out.add(field);
    }
  }
  return out;
}

/** equals/hashCode/compareTo karşılaştırmaya giren alan kümesi değişti mi (alan okunmuyorsa ayırt edilemez → true). */
function equalityFieldsChanged(oldM: JavaMember, newM: JavaMember, owner: JavaType | undefined): boolean {
  const fields = new Set([...Object.keys(owner?.fieldTypes ?? {}), ...(owner?.members.filter((m) => m.kind === 'field').map((m) => m.name) ?? [])]);
  if (fields.size === 0) return true;
  const a = referencedFields(oldM.text, fields);
  const b = referencedFields(newM.text, fields);
  if (a.size === 0 && b.size === 0) return true;
  return a.size !== b.size || [...a].some((x) => !b.has(x));
}

function callSummary(calls: readonly CallRef[], max = 3): string {
  const list = calls.slice(0, max).map((c) => `${basename(c.file)}:${c.line}`);
  return list.join(', ') + (calls.length > max ? ` ve ${calls.length - max} yer daha` : '');
}

const CONCURRENCY_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bsynchronized\b/, label: 'synchronized' },
  { re: /\bvolatile\b/, label: 'volatile' },
  { re: /\b(?:ReentrantLock|ReentrantReadWriteLock|StampedLock|ReadWriteLock|Semaphore|CountDownLatch)\b|\.(?:lock|tryLock|unlock)\(\)/, label: 'kilit (Lock)' },
  { re: /\bAtomic[A-Z]\w*/, label: 'Atomic*' },
  { re: /\bExecutorService\b|\bExecutors\.|\bThreadPoolExecutor\b|\bnew Thread\(/, label: 'iş parçacığı havuzu / Thread' },
  { re: /\bCompletableFuture\b/, label: 'CompletableFuture' },
  { re: /\.parallelStream\(\)|\.parallel\(\)/, label: 'paralel stream' },
  { re: /\bConcurrentHashMap\b|\bCopyOnWrite\w+/, label: 'eşzamanlı koleksiyon' },
];

const SQL_LITERAL_RE = /"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"/g;
const SQL_KEYWORD_RE = /\b(SELECT|INSERT|UPDATE|DELETE|MERGE|FROM|WHERE|JOIN)\b/i;

function sqlLiterals(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.match(SQL_LITERAL_RE) ?? []) {
    if (SQL_KEYWORD_RE.test(m) && /\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.test(m)) out.push(m.replace(/\s+/g, ' '));
  }
  return out.sort();
}

const GENERIC_THROW_RE = /throw\s+new\s+(?:RuntimeException|Exception|Throwable|Error)\s*\(/;
const GENERIC_CATCH_RE = /catch\s*\(\s*(?:final\s+)?(?:Exception|Throwable|RuntimeException)\s+\w+\s*\)/;
const MUTABLE_COLLECTION_RE = /\b(?:new\s+(?:HashMap|ArrayList|HashSet|LinkedList|TreeMap|LinkedHashMap|ConcurrentHashMap)\b|Map<|List<|Set<)/;

export function scoreMember(input: MemberRiskInput): RiskInfo {
  const { md, ownerKind } = input;
  const ch = md.change;
  // Anotasyon/javadoc farkıyla gelen 'signatureChanged' risk açısından 'modified' gibi değerlendirilir.
  const status = ch.status === 'signatureChanged' && !isBreakingSignature(ch) ? 'modified' : ch.status;
  if (!isSemanticChange(status)) {
    return status === 'cosmetic'
      ? makeRisk([{ code: 'cosmetic', message: 'Yalnızca biçim/yorum değişikliği', weight: 0 }])
      : makeRisk([]);
  }
  const W = RISK_WEIGHTS;
  const reasons: RiskReason[] = [];
  const add = (code: string, message: string, weight: number) => reasons.push({ code, message, weight });
  const oldM = md.oldMember;
  const newM = md.newMember;
  const oldVis = oldM?.visibility ?? ch.visibility;
  const api = isApiVisible(oldVis, input.ownerVisibility, ownerKind) || isApiVisible(ch.visibility, input.ownerVisibility, ownerKind);
  const isMethod = ch.kind === 'method' || ch.kind === 'constructor';

  // Silinmiş/değişmiş ama çağrılıyor: yalnız 'exact' tam ağırlık; yalnız 'likely' varsa yarım ağırlık; name-only sayılmaz.
  const stale = input.staleCalls.filter((c) => c.confidence !== 'name-only');
  if (stale.length > 0) {
    const n = stale.length;
    const exact = stale.some((c) => c.confidence === 'exact');
    const verb = status === 'removed' ? 'Silindi' : status === 'renamed' ? 'Yeniden adlandırıldı' : status === 'moved' ? 'Taşındı' : 'İmzası değişti';
    const typeHint =
      status === 'signatureChanged' && oldM && newM && oldM.name === newM.name && oldM.params.length === newM.params.length
        ? '; argüman tipleri yeni parametre tipleriyle uyuşmuyor gibi görünüyor'
        : '';
    const full = W.removedWithCallers + W.removedWithCallersPerCall * Math.min(n, 4);
    add(
      'removed-with-callers',
      exact
        ? `${verb} ama head'de hâlâ ${n} yerde eski haliyle çağrılıyor (${callSummary(stale)})${typeHint}; derleme veya çalışma zamanı hatası olası`
        : `${verb}; head'de ${n} yerde eski haliyle çağrılıyor olabilir (${callSummary(stale)})${typeHint}; çağrı yerleri kesin doğrulanamadı`,
      exact ? full : Math.round(full / 2),
    );
  }
  if (input.brokenOverrides.length > 0) {
    add(
      'override-broken',
      `Alt sınıflardaki ${input.brokenOverrides.length} metot @Override taşıyor ama artık hiçbir şeyi override etmiyor; derlenmez (${input.brokenOverrides.slice(0, 3).map(shortId).join(', ')})`,
      W.overrideBroken,
    );
  }
  if (input.orphanedOverrides && input.orphanedOverrides.length > 0) {
    add(
      'override-orphaned',
      `Alt sınıflardaki ${input.orphanedOverrides.length} metot artık bunu override etmiyor; asıl bildirim artık onlar (${input.orphanedOverrides.slice(0, 3).map(shortId).join(', ')})`,
      0,
    );
  }

  // API imza / silme / ad değişikliği
  if (status === 'signatureChanged') {
    const detail = ch.oldSignature ? `: ${ch.oldSignature} → ${ch.signature}` : '';
    if (api) {
      const prot = oldVis === 'protected' && ch.visibility === 'protected';
      add('public-api-signature', `${prot ? 'protected' : 'public'} API imzası değişti${detail}`, prot ? W.protectedApiSignature : W.publicApiSignature);
    } else {
      add('signature', `İmza değişti${detail}`, W.privateSignature);
    }
  } else if (status === 'removed') {
    if (api) add('public-api-removed', `${oldVis} üye silindi: ${oldM?.signature ?? ch.signature}`, W.publicApiRemoved);
    else add('removed', `Üye silindi: ${oldM?.signature ?? ch.signature}`, W.privateRemoved);
  } else if (status === 'renamed') {
    if (api) add('public-api-renamed', `${oldVis} üye yeniden adlandırıldı: ${ch.oldName ?? '?'} → ${ch.name}`, W.publicApiRenamed);
    else add('renamed', `Yeniden adlandırıldı: ${ch.oldName ?? '?'} → ${ch.name}`, W.privateSignature);
  } else if (status === 'moved') {
    add('moved', `Başka tipe taşındı${ch.oldId ? ` (${shortId(ch.oldId)} → ${shortId(ch.id)})` : ''}`, api ? W.moved : Math.round(W.moved / 2));
  } else if (status === 'added') {
    if (!isAbstractMember(newM, ownerKind)) {
      add('added', api ? 'Yeni public/protected üye eklendi' : 'Yeni üye eklendi', api ? W.addedPublic : W.addedPrivate);
    }
  }

  // Arayüz / soyut metot sözleşmesi
  const abstractNow = isAbstractMember(newM, ownerKind);
  const abstractBefore = isAbstractMember(oldM, ownerKind);
  const impl = input.implementationCount;
  if (isMethod && (abstractNow || abstractBefore) && status !== 'modified') {
    const what =
      status === 'added'
        ? `${ownerKind === 'interface' ? 'Arayüze' : 'Soyut sınıfa'} soyut metot eklendi; ${impl} implementasyonun hepsi bunu uygulamalı`
        : status === 'removed'
          ? `${ownerKind === 'interface' ? 'Arayüzden' : 'Soyut sınıftan'} soyut metot kaldırıldı; ${impl} implementasyondaki karşılığı artık sözleşme dışı`
          : `${ownerKind === 'interface' ? 'Arayüz' : 'Soyut'} metot sözleşmesi değişti; ${impl} implementasyon etkileniyor`;
    // İmza/silme nedeni zaten varsa taban düşürülür (aynı değişiklik iki kez sayılmasın)
    const base = reasons.some((r) => r.code.startsWith('public-api')) ? W.interfaceContract - 10 : W.interfaceContract;
    if (impl === 0) {
      // Implementasyon yoksa "0 implementasyonun hepsi uygulamalı" gibi anlamsız sayı üretilmez. Var olan (yeni olmayan)
      // arayüzde dış implementasyon olasılığı küçük bir katkıyla not edilir; yeni tip veya soyut sınıf/enum'da kural sessiz.
      if (ownerKind === 'interface' && !input.ownerAdded) {
        add('interface-contract', `${what.split(';')[0]}; repoda implementasyonu yok (framework üretiyor ya da dış implementasyonlar olabilir)`, 5);
      }
    } else {
      add('interface-contract', what, base + W.interfaceContractPerImpl * Math.min(impl, 5));
    }
  } else if (isMethod && ownerKind === 'interface' && newM?.modifiers.includes('default') && status === 'modified') {
    add('interface-default', `Arayüzün default metodu değişti; override etmeyen ${impl} implementasyonun davranışı değişir`, W.interfaceDefault + 3 * Math.min(impl, 5));
  }

  // Override edilen metot davranışı / template method
  const subs = ch.overriddenBy.length;
  if (isMethod && subs > 0 && (status === 'modified' || status === 'signatureChanged') && !abstractNow) {
    add('overridden-behavior', `Alt sınıflarda ${subs} kez override ediliyor; temel davranış değişikliği alt sınıflara (super çağrısı yapanlara) yayılır`, W.overriddenBehavior + W.overriddenBehaviorPerSub * Math.min(subs, 5));
  }
  if (isMethod && newM && (status === 'modified' || status === 'signatureChanged') && input.hookNames && input.hookNames.size > 0 && input.implementationCount > 0) {
    const hooks = newM.callSites.filter((c) => (c.receiverKind === 'none' || c.receiverKind === 'this') && !c.isConstructor && input.hookNames?.has(c.name) && c.name !== newM.name);
    if (hooks.length > 0) {
      const names = [...new Set(hooks.map((h) => h.name))];
      add('template-method', `Şablon metot (template method) değişti: alt sınıf kancalarını (${names.slice(0, 4).join(', ')}) çağıran akış; ${impl} alt tip etkileniyor`, W.templateMethod + W.templateMethodPerSub * Math.min(impl, 5));
    }
  }

  // Diff dışı çağıranlar
  // Ağırlık yalnız 'exact' çağıranlarla tam; 'likely' yarım ağırlık ve küçük tavanla; name-only sıfır.
  const likelyOutside = input.outsideLikelyCallers ?? 0;
  if ((input.outsideCallers > 0 || likelyOutside > 0) && status !== 'added' && status !== 'removed') {
    const n = input.outsideCallers;
    const exactWeight = n > 0 ? W.callersOutside + W.callersOutsidePer * Math.min(n, 10) : 0;
    const likelyWeight = likelyOutside > 0 ? Math.min(W.callersOutsideLikelyCap, Math.round((W.callersOutside + W.callersOutsidePer * Math.min(likelyOutside, 10)) / 2)) : 0;
    const parts: string[] = [];
    if (n > 0) parts.push(`${n} çağıranı var`);
    if (likelyOutside > 0) parts.push(`${likelyOutside} olası (alıcı tipi kesin çözülemeyen) çağıranı var`);
    add('callers-outside-diff', `Diff dışında ${parts.join(', ')}; değişiklik onlara yayılır`, exactWeight + (n > 0 ? Math.min(likelyWeight, 5) : likelyWeight));
  }

  if (oldM && newM) {
    // Anlam taşıyan anotasyonlar
    const annChanges = semanticAnnotationChanges(oldM.text, newM.text, oldM.annotations, newM.annotations);
    let annTotal = 0;
    for (const a of annChanges) {
      const w = Math.min(a.weight, W.annotationCap - annTotal);
      if (w <= 0) break;
      annTotal += w;
      add(`annotation-${a.key}`, describeAnnotationChange(a), w);
    }

    // equals / hashCode / compareTo / toString
    const name = newM.name;
    // Yalnız Object/Comparable sözleşme metotları (örnek metot, standart arity): statik ObjectUtils.equals(a, b) değil.
    const instance = ch.kind === 'method' && !newM.modifiers.includes('static');
    const isContract = instance && newM.params.length === (name === 'hashCode' || name === 'toString' ? 0 : 1);
    if (isContract && (name === 'equals' || name === 'hashCode' || name === 'compareTo')) {
      // Anlamlı değişiklik: karşılaştırmaya giren alan kümesi değişti (ya da hiç alan okunmuyor, ayırt edilemiyor).
      // Aynı alanlarla yeniden yazım (Objects.hashCode(x) ↔ x == null ? 0 : x.hashCode()) düşük ağırlık alır.
      const meaningful = equalityFieldsChanged(oldM, newM, input.ownerType);
      add(
        'equality-contract',
        meaningful
          ? `${name} değişti: koleksiyonlarda (HashMap/HashSet/TreeSet), sıralamada ve eşitlik karşılaştırmalarında davranış değişir`
          : `${name} yeniden yazıldı (aynı alanlar kullanılıyor); eşitlik/sıralama davranışının korunduğunu doğrulayın`,
        meaningful ? W.equalityContract : W.equalityRewrite,
      );
      const pair = name === 'equals' ? 'hashCode' : name === 'hashCode' ? 'equals' : undefined;
      const ownerHasPair = pair && input.ownerType?.members.some((m) => m.name === pair && m.kind === 'method');
      if (meaningful && pair && ownerHasPair && !input.changedSiblingNames?.has(pair)) {
        add('equals-hashcode-mismatch', `${name} değişti ama ${pair} değişmedi; equals/hashCode sözleşmesi bozulabilir`, W.equalsHashCodeMismatch);
      }
    } else if (isContract && name === 'toString' && (input.changedSiblingNames?.has('equals') || input.changedSiblingNames?.has('hashCode'))) {
      add('equality-contract', 'toString, equals/hashCode ile birlikte değişti; kimlik/temsil mantığı yeniden tanımlanıyor', W.toStringWithEquals);
    }

    // Eşzamanlılık
    const conc: string[] = [];
    for (const p of CONCURRENCY_PATTERNS) {
      const before = countMatches(oldM.text, p.re);
      const after = countMatches(newM.text, p.re);
      if (before !== after) conc.push(`${p.label} ${after > before ? 'eklendi' : 'kaldırıldı'}`);
    }
    if (newM.features.synchronizedBlocks !== oldM.features.synchronizedBlocks && !conc.some((c) => c.startsWith('synchronized'))) {
      conc.push(`synchronized blok sayısı ${oldM.features.synchronizedBlocks} → ${newM.features.synchronizedBlocks}`);
    }
    if (conc.length) add('concurrency', `Eşzamanlılık davranışı değişti: ${conc.join(', ')}`, W.concurrency);

    // Hata yönetimi
    const of = oldM.features;
    const nf = newM.features;
    if (nf.emptyCatches > of.emptyCatches) add('empty-catch', `Boş catch bloğu eklendi (${of.emptyCatches} → ${nf.emptyCatches}); hata sessizce yutuluyor`, W.emptyCatch);
    else if (nf.catches !== of.catches) add('catch-changed', `catch sayısı değişti (${of.catches} → ${nf.catches}); hata yönetimi akışı farklı`, W.catchCountChanged);
    if (countMatches(newM.text, GENERIC_THROW_RE) > countMatches(oldM.text, GENERIC_THROW_RE)) {
      add('generic-throw', 'Genel istisna fırlatılıyor (throw new RuntimeException/Exception); çağıranlar ayırt edemez', W.genericThrow);
    }
    if (countMatches(newM.text, GENERIC_CATCH_RE) > countMatches(oldM.text, GENERIC_CATCH_RE)) {
      add('generic-catch', 'Genel istisna yakalanıyor (catch Exception/Throwable)', W.genericCatch);
    }
    if (nf.printStackTrace > of.printStackTrace) add('print-stack-trace', 'printStackTrace eklendi; loglama yerine konsola yazılıyor', W.printStackTrace);
    if (nf.systemOut > of.systemOut) add('system-out', 'System.out/err kullanımı eklendi', W.systemOut);

    // SQL
    const oldSql = sqlLiterals(oldM.text);
    const newSql = sqlLiterals(newM.text);
    const sqlChanged = oldSql.join('\n') !== newSql.join('\n') || of.sqlStrings !== nf.sqlStrings;
    if (sqlChanged && !reasons.some((r) => r.code === 'annotation-query')) {
      add('sql-change', `SQL metni değişti (${oldSql.length} → ${newSql.length} sorgu literali)`, W.sqlChange);
    }

    // Büyüklük / karmaşıklık
    const lines = ch.linesAdded + ch.linesRemoved;
    if (lines > 150) add('large-body', `Çok büyük değişiklik: ${lines} satır`, W.veryLargeBody);
    else if (lines > 50) add('large-body', `Büyük değişiklik: ${lines} satır`, W.largeBody);
    const dc = newM.complexity - oldM.complexity;
    if (dc >= 5) add('complexity', `Karmaşıklık arttı (${oldM.complexity} → ${newM.complexity})`, Math.min(W.complexity + (dc - 5), W.complexityCap));

    // Null güvenliği
    if (nf.nullChecks < of.nullChecks) add('null-checks-decreased', `Null kontrolleri azaldı (${of.nullChecks} → ${nf.nullChecks})`, W.nullChecksDecreased);
    if (nf.returnsNull > of.returnsNull) add('returns-null', `'return null' eklendi (${of.returnsNull} → ${nf.returnsNull}); çağıranlarda NPE riski`, W.returnsNullAdded);

    // Alan başlatıcısı
    if (ch.kind === 'field' && (oldM.initializerText ?? '') !== (newM.initializerText ?? '')) {
      add('field-initializer', `Alan başlangıç değeri değişti: ${oldM.initializerText ?? '(yok)'} → ${newM.initializerText ?? '(yok)'}`, W.fieldInitializer);
    }

    if (ch.status === 'modified' && ch.flags.includes('body')) add('body-changed', 'Gövde değişti', W.bodyChanged);
  }

  // Eklenen kodda da kontrol edilen kalıplar
  if (newM && !oldM) {
    if (newM.features.emptyCatches > 0) add('empty-catch', 'Yeni kodda boş catch bloğu var; hata sessizce yutuluyor', W.emptyCatch);
    if (newM.features.printStackTrace > 0) add('print-stack-trace', 'Yeni kodda printStackTrace var', W.printStackTrace);
    if (newM.features.systemOut > 0) add('system-out', 'Yeni kodda System.out/err kullanımı var', W.systemOut);
    if (countMatches(newM.text, GENERIC_THROW_RE) > 0) add('generic-throw', 'Yeni kodda genel istisna fırlatılıyor', W.genericThrow);
    if (newM.complexity >= 10) add('complexity', `Yeni metot karmaşık (karmaşıklık ${newM.complexity})`, W.complexity);
    if (ch.linesAdded > 50) add('large-body', `Büyük yeni üye: ${ch.linesAdded} satır`, W.largeBody);
    const annChanges = semanticAnnotationChanges(undefined, newM.text, [], newM.annotations);
    for (const a of annChanges) {
      if (a.key === 'query') continue;
      add(`annotation-${a.key}`, `Yeni üyede anlam taşıyan anotasyon (${a.label}): ${a.added.join(', ')}`, Math.round(a.weight * W.addedSemanticAnnotationFactor));
    }
    const sql = sqlLiterals(newM.text);
    if (sql.length > 0 || newM.features.sqlStrings > 0 || annChanges.some((a) => a.key === 'query')) {
      add('sql-change', `Yeni SQL/JPQL sorgusu eklendi${sql[0] ? `: ${sql[0].slice(0, 80)}` : ''}`, W.sqlChange);
    }
  }
  if (newM && ch.kind === 'field' && status === 'added' && newM.modifiers.includes('static')) {
    const final = newM.modifiers.includes('final');
    if (!final || MUTABLE_COLLECTION_RE.test(`${newM.fieldType ?? ''} ${newM.initializerText ?? ''}`)) {
      add('static-mutable', `Değişebilir static alan eklendi (${newM.signature}); paylaşılan durum, iş parçacığı güvenliği riski`, W.staticMutable);
    }
  }
  if (newM && oldM && ch.kind === 'field' && newM.modifiers.includes('static') && oldM.modifiers.includes('final') && !newM.modifiers.includes('final')) {
    add('static-mutable', 'static alan final olmaktan çıktı; paylaşılan değişebilir durum', W.staticMutable);
  }

  // Gövde değişikliği + diff dışı çağıranlar birlikte en fazla orta risk: çağıran ağırlığı kırpılır.
  const callersReason = reasons.find((r) => r.code === 'callers-outside-diff');
  const bodyReason = reasons.find((r) => r.code === 'body-changed');
  if (callersReason && bodyReason && callersReason.weight + bodyReason.weight > W.bodyWithCallersCap) {
    callersReason.weight = Math.max(0, W.bodyWithCallersCap - bodyReason.weight);
  }

  addArchitecture(reasons, input.architecture);
  return finalize(reasons, input.isTest);
}

function finalize(reasons: RiskReason[], isTest: boolean): RiskInfo {
  const raw = reasons.reduce((s, r) => s + r.weight, 0);
  if (isTest && raw > 0) {
    const capped = Math.min(100, raw);
    const half = Math.round(capped / 2);
    reasons.push({ code: 'test-code', message: 'Test kodu: risk yarıya indirildi', weight: half - capped });
    return makeRisk(reasons, half);
  }
  return makeRisk(reasons);
}

export function shortId(id: string): string {
  const i = id.indexOf('#');
  if (i < 0) return simpleTypeName(id);
  const owner = simpleTypeName(id.slice(0, i));
  return `${owner}.${id.slice(i + 1)}`;
}

const RISKY_CONFIG: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /ddl-auto\s*[:=]\s*(update|create|create-drop)\b/, label: 'hibernate ddl-auto şemayı otomatik değiştiriyor' },
  { re: /show-sql\s*[:=]\s*true/, label: 'SQL loglama açık' },
  { re: /(password|secret|token|api[-_]?key)\s*[:=]\s*\S+/i, label: 'yapılandırmada gizli bilgi olabilir' },
  { re: /(enabled|csrf)\s*[:=]\s*false/i, label: 'bir özellik/koruma kapatıldı' },
  { re: /(max-pool-size|maximum-pool-size|pool-size|timeout)\s*[:=]/i, label: 'havuz/zaman aşımı ayarı değişti' },
];

// ---------------------------------------------------------------------------
// Tip ve dosya riski
// ---------------------------------------------------------------------------

export interface TypeRiskInput {
  td: TypeDiff;
  memberRisks: RiskInfo[];
  isTest: boolean;
  /** Silinmiş/yeniden adlandırılmış tipe head'de hâlâ referans veren dosyalar. */
  staleTypeRefs: readonly string[];
  subTypeCount: number;
  architecture?: readonly ArchitectureIssue[];
  /** Bu tipin kullandığı basit adların import hedefi değişti (javax → jakarta). */
  importRetargets?: readonly { from: string; to: string }[];
  /** Hedef değişiminin anlam taşıyan bir pakette olup olmadığı (orta risk). */
  meaningfulImport?: (name: string) => boolean;
}

/** Tip riski = max(tip düzeyi kurallar, en riskli üye) + diğer üyelerden küçük katkı (en fazla 10). */
export function scoreType(input: TypeRiskInput): RiskInfo {
  const { td } = input;
  const ch = td.change;
  const W = RISK_WEIGHTS;
  if (!isSemanticChange(ch.status) && input.memberRisks.every((r) => r.score === 0)) {
    return ch.status === 'cosmetic' ? makeRisk([{ code: 'cosmetic', message: 'Yalnızca biçim/yorum değişikliği', weight: 0 }]) : makeRisk([]);
  }
  const reasons: RiskReason[] = [];
  const add = (code: string, message: string, weight: number) => reasons.push({ code, message, weight });
  const api = ch.visibility === 'public' || ch.visibility === 'protected' || td.oldType?.visibility === 'public';

  if (input.staleTypeRefs.length > 0) {
    add('removed-with-callers', `${ch.status === 'removed' ? 'Tip silindi' : 'Tip yeniden adlandırıldı/taşındı'} ama head'de ${input.staleTypeRefs.length} dosya hâlâ eski adıyla referans veriyor (${input.staleTypeRefs.slice(0, 3).map(basename).join(', ')})`, W.typeRemovedReferenced + 5 * Math.min(input.staleTypeRefs.length, 4));
  }
  if (ch.status === 'removed' && api) add('type-removed', `${ch.kind === 'interface' ? 'Arayüz' : 'Tip'} silindi: ${ch.name}`, W.typeRemoved);
  const movedWithOuter = !!td.oldType?.outerFqn && !!td.newType?.outerFqn && td.oldType.outerFqn !== td.newType.outerFqn;
  if ((ch.status === 'renamed' || ch.status === 'moved') && api && !movedWithOuter) add('type-renamed', `Tip yeniden adlandırıldı/taşındı: ${ch.oldId ?? '?'} → ${ch.id}`, W.typeRenamed);
  if (td.oldType && td.newType) {
    const oldSupers = (ch.oldSuperTypes ?? [...(td.oldType.superclass ? [td.oldType.superclass] : []), ...td.oldType.interfaces]).map(simpleTypeName).sort();
    const newSupers = ch.superTypes.map(simpleTypeName).sort();
    // A1 'supertypes' bayrağı: basit adlar aynı kalsa da çözülmüş FQN'ler değiştiyse (başka paketteki aynı adlı tip) kalıtım değişmiştir.
    const fqnChanged =
      ch.flags.includes('supertypes') && ch.oldSuperTypes !== undefined && [...ch.oldSuperTypes].sort().join(',') !== [...ch.superTypes].sort().join(',');
    if (oldSupers.join(',') !== newSupers.join(',') || fqnChanged) {
      add('supertypes-changed', `Kalıtım değişti: [${oldSupers.join(', ') || '-'}] → [${newSupers.join(', ') || '-'}]`, W.superTypesChanged);
    }
    const rank = { public: 3, protected: 2, package: 1, private: 0 } as const;
    if (rank[td.newType.visibility] < rank[td.oldType.visibility]) {
      add('visibility-narrowed', `Tip görünürlüğü daraldı: ${td.oldType.visibility} → ${td.newType.visibility}`, W.typeVisibilityNarrowed);
    }
    const annChanges = semanticAnnotationChanges(undefined, undefined, td.oldType.annotations, td.newType.annotations, true);
    let annTotal = 0;
    for (const a of annChanges) {
      const w = Math.min(a.weight, W.annotationCap - annTotal);
      if (w <= 0) break;
      annTotal += w;
      add(`annotation-${a.key}`, describeAnnotationChange(a).replace('Anlam taşıyan anotasyon değişti', 'Tip anotasyonu değişti'), w);
    }
  }
  if (ch.status === 'added' && api) add('type-added', `Yeni ${ch.kind === 'interface' ? 'arayüz' : 'tip'} eklendi`, W.addedPublic);
  if (input.importRetargets?.length) {
    const list = input.importRetargets;
    const meaningful = list.some((r) => input.meaningfulImport?.(r.from) || input.meaningfulImport?.(r.to));
    add(
      'import-retarget',
      `Import hedefi değişti: ${list.slice(0, 3).map((r) => `${r.from} → ${r.to}`).join(', ')}${list.length > 3 ? ` ve ${list.length - 3} import daha` : ''}; aynı ad artık başka bir tipe bağlanıyor`,
      meaningful ? W.importRetargetMeaningful : W.importRetarget,
    );
  }
  addArchitecture(reasons, input.architecture);

  let typeLevel = reasons.reduce((s, r) => s + r.weight, 0);
  if (input.isTest) typeLevel = Math.round(typeLevel / 2);
  const scores = input.memberRisks.map((r) => r.score).sort((a, b) => b - a);
  const maxMember = scores[0] ?? 0;
  const rest = scores.slice(1).reduce((s, x) => s + x, 0);
  const base = Math.max(typeLevel, maxMember);
  const bonus = Math.min(10, Math.floor(rest / 10));
  const score = Math.min(100, base + bonus);

  const top = topMemberReasons(input.memberRisks, 3);
  const all = [...reasons, ...top];
  if (bonus > 0) all.push({ code: 'many-changes', message: `Tipte başka riskli değişiklikler de var (+${bonus})`, weight: bonus });
  return makeRisk(dedupeReasons(all), score);
}

function topMemberReasons(risks: RiskInfo[], max: number): RiskReason[] {
  const sorted = [...risks].sort((a, b) => b.score - a.score);
  const out: RiskReason[] = [];
  for (const r of sorted) for (const reason of r.reasons) if (reason.weight > 0) out.push(reason);
  return out.sort((a, b) => b.weight - a.weight).slice(0, max);
}

function dedupeReasons(reasons: RiskReason[]): RiskReason[] {
  const seen = new Set<string>();
  const out: RiskReason[] = [];
  for (const r of reasons) {
    const key = `${r.code}|${r.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Java dosya riski = en yüksek tip/üye riski + toplam küçük katkı (en fazla 10). */
export function scoreJavaFile(typeRisks: RiskInfo[], memberRisks: RiskInfo[]): RiskInfo {
  const all = [...typeRisks, ...memberRisks];
  const scores = all.map((r) => r.score).sort((a, b) => b - a);
  const max = scores[0] ?? 0;
  if (max === 0) {
    const cosmetic = all.some((r) => r.reasons.some((x) => x.code === 'cosmetic'));
    return cosmetic ? makeRisk([{ code: 'cosmetic', message: 'Yalnızca biçim/yorum değişikliği', weight: 0 }]) : makeRisk([]);
  }
  const memberScores = memberRisks.map((r) => r.score).sort((a, b) => b - a);
  const rest = memberScores.slice(1).reduce((s, x) => s + x, 0);
  const bonus = Math.min(10, Math.floor(rest / 15));
  const best = [...typeRisks].sort((a, b) => b.score - a.score)[0];
  const reasons = dedupeReasons([...(best?.reasons ?? []), ...topMemberReasons(memberRisks, 3)]).slice(0, 6);
  return makeRisk(reasons, Math.min(100, max + bonus));
}

/** Java dışı dosya ya da içeriği okunamayan dosya riski. */
export function scoreNonJavaFile(file: Pick<FileChange, 'path' | 'status' | 'language' | 'hunks' | 'additions' | 'deletions' | 'isTest' | 'cosmeticOnly'>, opts: { unanalyzedJava?: boolean } = {}): RiskInfo {
  if (file.cosmeticOnly) return makeRisk([{ code: 'cosmetic', message: 'Yalnızca boşluk/biçim değişikliği', weight: 0 }]);
  const W = RISK_WEIGHTS;
  const reasons: RiskReason[] = [];
  const add = (code: string, message: string, weight: number) => reasons.push({ code, message, weight });
  const name = basename(file.path).toLowerCase();
  const changedText = file.hunks.flatMap((h) => h.lines.filter((l) => l.type !== 'context').map((l) => l.text)).join('\n');

  if (opts.unanalyzedJava) {
    add('unanalyzed', 'Dosya içeriği alınamadı; sembol düzeyinde analiz yapılamadı, diff elle incelenmeli', W.unanalyzedJava);
  } else if (name === 'module-info.java') {
    const directives = [...new Set([...changedText.matchAll(/\b(requires|exports|opens|provides|uses)\b/g)].map((m) => m[1]))];
    if (directives.length) {
      add('module-descriptor', `Modül bildirimi değişti (${directives.join(', ')}); modül sınırı/bağımlılıkları ve dışa açılan paketler etkilenir`, W.moduleDescriptor);
    } else {
      add('package-info', 'Modül bildirimi (module-info) değişti', W.packageInfo);
    }
  } else if (name === 'package-info.java') {
    add('package-info', 'Paket bildirimi (package-info: paket anotasyonları/javadoc) değişti', W.packageInfo);
  } else if (name === 'pom.xml' || name.endsWith('.gradle') || name.endsWith('.gradle.kts') || name === 'gradle.properties' || name.endsWith('.versions.toml')) {
    if (/<(dependency|artifactId|version|plugin|parent)>|\b(implementation|api|compileOnly|runtimeOnly|testImplementation|annotationProcessor|classpath|id)\b\s*[("']|version\s*=|\bplatform\(/.test(changedText)) {
      add('build-dependency', 'Bağımlılık/sürüm değişikliği: derleme, uyumluluk ve güvenlik etkilerini kontrol edin', W.buildDependency);
    } else {
      add('build-change', 'Build yapılandırması değişti', W.buildOther);
    }
  } else if (/(^|\/)db\/migration\/|(^|\/)(migrations?|changelog|liquibase|flyway)\//i.test(file.path) || file.language === 'sql') {
    if (file.status === 'deleted') add('sql-migration', 'SQL migration dosyası silindi; uygulanmış migration geçmişi bozulabilir', W.sqlMigrationDeleted);
    else if (file.status === 'modified' && /(^|\/)db\/migration\//.test(file.path)) add('sql-migration', 'Var olan SQL migration dosyası değiştirildi; daha önce uygulanmış ortamlarda checksum hatası verir', W.sqlMigrationDeleted);
    else add('sql-migration', 'Veritabanı şeması/verisi değişiyor (SQL migration)', W.sqlMigration);
  } else if (/^(application|bootstrap)([-.][\w-]+)?\.(ya?ml|properties)$/.test(name) || (file.language === 'yaml' || file.language === 'properties')) {
    add('config-change', 'Uygulama yapılandırması değişti; ortam bazlı davranış etkilenir', W.configChange);
    const added = file.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add').map((l) => l.text)).join('\n');
    const risky = RISKY_CONFIG.filter((r) => r.re.test(added)).map((r) => r.label);
    if (risky.length) add('risky-config', `Riskli ayar: ${risky.join(', ')}`, W.riskyConfigValue);
  } else if (file.additions + file.deletions > 0 || file.status !== 'modified') {
    add('file-change', 'Dosya değişti', W.otherFile);
  }
  return finalize(reasons, file.isTest);
}

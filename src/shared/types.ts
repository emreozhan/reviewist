/**
 * Reviewist ortak sözleşmesi.
 * Sunucu (core + sources + server) ile web arayüzü bu tipler üzerinden konuşur.
 * Bu dosyayı değiştirmek tüm şeritleri etkiler; değişiklik gerekiyorsa orkestratöre bildir.
 */

// ---------------------------------------------------------------------------
// Kaynak (git / GitHub PR / patch) tarafı
// ---------------------------------------------------------------------------

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  oldNo?: number; // eski dosyadaki satır no (1 tabanlı), add satırında yok
  newNo?: number; // yeni dosyadaki satır no (1 tabanlı), del satırında yok
  text: string; // baştaki '+', '-', ' ' işareti olmadan
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string; // '@@ ... @@' sonrasındaki bağlam metni (boş olabilir)
  lines: DiffLine[];
}

export interface ReviewSourceInfo {
  kind: 'git' | 'github' | 'patch';
  title: string; // insan okunur başlık: "main...feature/x" veya PR başlığı
  repoPath?: string;
  baseRef: string;
  headRef: string; // çalışma ağacı modunda 'WORKTREE'
  baseSha?: string;
  headSha?: string;
  prUrl?: string;
  prNumber?: number;
  author?: string;
  description?: string; // PR gövdesi (markdown)
  /** Aynı incelemenin tekrar analizlerinde değişmeyen anahtar (görüldü/not kalıcılığı için). */
  stableKey: string;
}

export interface ChangeSetFile {
  path: string; // yeni yol (deleted ise eski yol)
  oldPath?: string; // renamed/copied ise eski yol
  status: FileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

/** Bir kaynaktan (git, GitHub, patch) üretilen ham değişiklik kümesi. core/buildReview bunu tüketir. */
export interface ChangeSet {
  info: ReviewSourceInfo;
  files: ChangeSetFile[];
  /** Dosyanın tam içeriği. Kaynak içerik veremiyorsa (ör. salt patch) undefined döner. */
  readFile(side: 'old' | 'new', path: string): Promise<string | undefined>;
  /**
   * Head (yeni) taraftaki tüm dosya yolları; repo geneli indeks (çağıranlar, alt sınıflar) için.
   * Desteklenmiyorsa boş dizi döner. `ext` verilirse yalnızca o uzantıdakiler (ör. '.java').
   */
  listFiles(side: 'new', ext?: string): Promise<string[]>;
  /**
   * (Tur 3, opsiyonel) İçeriğin kararlı kimliği (git blob SHA). Varsa core ayrıştırma sonucunu bununla önbellekler.
   * Çalışma ağacındaki diske ait dosyalar için undefined.
   */
  blobId?(side: 'old' | 'new', path: string): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Analiz sonucu (ReviewModel)
// ---------------------------------------------------------------------------

export type Layer =
  | 'domain'
  | 'application'
  | 'port'
  | 'adapter-in'
  | 'adapter-out'
  | 'controller'
  | 'service'
  | 'repository'
  | 'model'
  | 'config'
  | 'util'
  | 'test'
  | 'build'
  | 'resource'
  | 'other';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskReason {
  code: string; // makine kodu: 'public-api-signature', 'removed-with-callers', ...
  message: string; // Türkçe açıklama
  weight: number; // skora katkı
}

export interface RiskInfo {
  score: number; // 0-100
  level: RiskLevel;
  reasons: RiskReason[];
}

export interface Range {
  startLine: number; // 1 tabanlı, dahil
  endLine: number; // 1 tabanlı, dahil
}

export type TypeKind = 'class' | 'interface' | 'enum' | 'record' | 'annotation';
export type MemberKind = 'method' | 'constructor' | 'field' | 'enumConstant' | 'initializer';
export type SymbolKind = TypeKind | MemberKind;

export type ChangeStatus =
  | 'added'
  | 'removed'
  | 'modified' // gövde/anlam değişti, imza aynı
  | 'signatureChanged' // parametre/dönüş/throws/görünürlük vb. değişti
  | 'renamed' // ad değişti, gövde büyük ölçüde aynı
  | 'moved' // başka tipe/dosyaya taşındı
  | 'cosmetic' // yalnızca boşluk/biçim/yorum/javadoc
  | 'unchanged';

export type ChangeFlag =
  | 'visibility'
  | 'modifiers'
  | 'annotations'
  | 'params'
  | 'returnType'
  | 'throws'
  | 'body'
  | 'javadoc'
  | 'formatting'
  | 'typeParams'
  | 'fieldType'
  | 'initializer'
  | 'supertypes'; // tip düzeyi: extends/implements değişti

export interface CallRef {
  fromId: string; // çağıran sembolün id'si
  file: string;
  line: number;
  inChangedCode: boolean; // çağrı satırı bu diff içinde mi
  confidence: 'exact' | 'likely' | 'name-only';
}

export interface MemberChange {
  id: string; // sembol id: 'com.acme.OrderService#place(Order,int)' / alan: 'com.acme.Order#total'
  oldId?: string;
  kind: MemberKind;
  name: string;
  oldName?: string;
  ownerTypeId: string; // TypeChange.id
  signature: string; // okunur imza: 'public Order place(Order order, int qty) throws X'
  oldSignature?: string;
  visibility: 'public' | 'protected' | 'package' | 'private';
  status: ChangeStatus;
  flags: ChangeFlag[];
  details: string[]; // Türkçe maddeler: 'görünürlük public → private', '@Transactional eklendi'
  oldRange?: Range;
  newRange?: Range;
  linesAdded: number;
  linesRemoved: number;
  overrides: string[]; // bu metodun override ettiği üst tip metot id'leri
  overriddenBy: string[]; // alt tiplerde bunu override eden metot id'leri
  callers: CallRef[]; // head tarafında bu sembolü çağıranlar
  callees: string[]; // bu sembolün çağırdığı (çözülebilen) sembol id'leri
  risk: RiskInfo;
  groupId?: string;
}

export interface TypeChange {
  id: string; // FQN: 'com.acme.order.OrderService' (iç tip: 'com.acme.Outer.Inner')
  oldId?: string;
  name: string; // basit ad
  kind: TypeKind;
  file: string; // FileChange.path
  status: ChangeStatus;
  flags: ChangeFlag[];
  details: string[];
  visibility: 'public' | 'protected' | 'package' | 'private';
  annotations: string[]; // '@Service', '@Entity' ...
  superTypes: string[]; // head: extends + implements (çözülebilenler FQN, değilse basit ad)
  oldSuperTypes?: string[];
  subTypes: string[]; // repo içindeki doğrudan alt tipler/implementasyonlar (FQN)
  oldRange?: Range;
  newRange?: Range;
  members: MemberChange[]; // tüm üyeler; değişmeyenler status 'unchanged' ile (iskelet görünümü için)
  layer: Layer;
  risk: RiskInfo;
}

export interface FileChange {
  id: string; // = path
  path: string;
  oldPath?: string;
  status: FileStatus;
  language: 'java' | 'kotlin' | 'xml' | 'yaml' | 'properties' | 'sql' | 'gradle' | 'json' | 'markdown' | 'other';
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  module?: string; // maven/gradle modül dizini (varsa)
  packageName?: string;
  layer: Layer;
  isTest: boolean;
  /** Yalnızca import/boşluk/biçim/yorum değişikliği: reviewer atlayabilir. */
  cosmeticOnly: boolean;
  typeIds: string[]; // bu dosyadaki TypeChange id'leri
  relatedTestFiles: string[]; // bu dosyayı test ettiği tahmin edilen test dosyaları (repo genelinde)
  risk: RiskInfo;
  reviewOrder: number; // önerilen okuma sırası (1 tabanlı)
  parseError?: string;
}

export type ImpactNodeStatus = ChangeStatus | 'impacted';

export interface ImpactNode {
  id: string; // sembol id veya tip id
  label: string;
  kind: SymbolKind;
  status: ImpactNodeStatus; // 'impacted' = değişmedi ama değişen bir şeye bağımlı (çağıran, alt sınıf)
  file?: string;
  typeId?: string;
  layer: Layer;
  riskLevel: RiskLevel;
  /** Head tarafındaki bildirim aralığı (silinmişse eski taraf); diff dışı önizleme için. */
  range?: Range;
  rangeSide?: 'old' | 'new';
}

export interface ImpactEdge {
  id: string;
  from: string;
  to: string;
  kind: 'calls' | 'extends' | 'implements' | 'overrides' | 'contains' | 'tests';
}

export interface ImpactGraph {
  nodes: ImpactNode[];
  edges: ImpactEdge[];
}

/** Birbirine bağlı değişiklik kümesi (mantıksal "hikâye"). */
export interface ChangeGroup {
  id: string;
  title: string; // 'OrderService.place imzası ve 4 çağıranı'
  description: string;
  symbolIds: string[];
  fileIds: string[];
  riskLevel: RiskLevel;
}

export interface ReviewStep {
  order: number;
  fileId: string;
  symbolIds: string[]; // bu adımda bakılacak değişen semboller
  reason: string; // 'Sözleşme önce: arayüz değişikliği, 3 implementasyonu etkiliyor'
}

export type FindingCategory =
  | 'api'
  | 'inheritance'
  | 'callers'
  | 'test'
  | 'architecture'
  | 'risk'
  | 'cosmetic'
  | 'complexity'
  | 'other';

export interface Finding {
  id: string;
  severity: 'info' | 'warning' | 'error';
  category: FindingCategory;
  title: string;
  message: string;
  file?: string;
  line?: number;
  symbolIds?: string[];
}

export interface ReviewSummary {
  files: number;
  javaFiles: number;
  testFiles: number;
  additions: number;
  deletions: number;
  typesChanged: number;
  membersChanged: number;
  publicApiChanges: number;
  cosmeticFiles: number;
  highRiskItems: number; // high + critical
  impactedOutsideDiff: number; // diff dışında etkilenen sembol sayısı
  untestedChanges: number; // ilgili testi olmayan değişen üretim tipi
}

export interface ReviewModel {
  id: string;
  createdAt: string; // ISO
  source: ReviewSourceInfo;
  summary: ReviewSummary;
  files: FileChange[];
  types: TypeChange[];
  graph: ImpactGraph;
  groups: ChangeGroup[];
  reviewPlan: ReviewStep[];
  findings: Finding[];
  warnings: string[]; // analiz sırasında oluşan sorunlar (ayrıştırma hatası, limit aşımı...)
}

// ---------------------------------------------------------------------------
// HTTP API sözleşmesi
// ---------------------------------------------------------------------------

export type ReviewRequest =
  | { kind: 'git'; repoPath: string; base: string; head: string; mode?: 'range' | 'mergeBase' }
  | { kind: 'worktree'; repoPath: string; base?: string; includeUntracked?: boolean }
  | { kind: 'github'; url: string; token?: string; localRepoPath?: string }
  | { kind: 'patch'; text: string; repoPath?: string };

export interface ReviewListItem {
  id: string;
  title: string;
  createdAt: string;
  kind: ReviewSourceInfo['kind'];
  files: number;
}

export interface GitRefs {
  repoPath: string;
  currentBranch?: string;
  defaultBase?: string; // main/master/develop tahmini
  branches: string[];
  /** (Tur 5) Yerel dallar, en son commit tarihine göre yeniden eskiye; head önerisi için. */
  recentBranches?: string[];
  remoteBranches: string[];
  tags: string[];
  recentCommits: { sha: string; subject: string; author: string; date: string }[];
}

export interface AppConfig {
  version: string;
  defaultRepoPath?: string;
  initialReviewId?: string;
  githubTokenConfigured: boolean;
}

export interface ApiError {
  error: string; // Türkçe mesaj
  detail?: string;
  field?: string; // doğrulama hatasında ilgili istek alanı (ör. 'url', 'base')
}

export type ReviewJobStatus = 'running' | 'done' | 'error';

export interface ReviewJob {
  id: string;
  status: ReviewJobStatus;
  startedAt: string; // ISO
  /** Sırayla ilerleme mesajları (Türkçe), ör. 'Repo indeksi: 1200/3400 dosya'. */
  progress: { at: string; message: string }[];
  reviewId?: string; // status 'done'
  error?: ApiError; // status 'error'
}

// ---------------------------------------------------------------------------
// Kod gezinme (Tur 4): koddaki tıklanabilir referanslar ve sembol konumları
// ---------------------------------------------------------------------------

/** Bir dosyadaki sembol bildirimi (tip, metot, yapıcı, alan, enum sabiti). */
export interface SymbolDecl {
  id: string; // ReviewModel'deki id ile aynı biçim (çift FQN'de '@kök' soneki dahil)
  kind: SymbolKind;
  name: string;
  signature: string;
  ownerTypeId?: string; // üyeler için
  range: Range; // bildirim aralığı (javadoc hariç)
  /** Bildirimdeki ad tanımlayıcısının konumu: satır 1 tabanlı, sütunlar satır içi 0 tabanlı UTF-16 [start, end). */
  nameLine: number;
  nameStartCol: number;
  nameEndCol: number;
  /** Sembol ReviewModel'de değişen bir öğeyse durumu; değilse undefined. */
  status?: ChangeStatus;
}

/** Kodda tıklanabilir bir referans (çağrı, yapıcı, tip adı, metot referansı). */
export interface SymbolRef {
  line: number; // 1 tabanlı
  startCol: number; // satır içi 0 tabanlı UTF-16, dahil
  endCol: number; // hariç
  name: string;
  kind: 'call' | 'constructor' | 'type' | 'methodRef';
  /** Çözülen hedef sembol id'leri (aşırı yüklemede birden çok olabilir; çözülemezse boş). */
  targets: string[];
  confidence?: 'exact' | 'likely' | 'name-only';
}

export interface FileOutline {
  path: string;
  side: 'old' | 'new';
  inDiff: boolean;
  packageName?: string;
  decls: SymbolDecl[];
  /** Yalnızca Java dosyalarında; 'old' tarafta hedefler çözülmeyebilir (boş targets). */
  refs: SymbolRef[];
}

/** Herhangi bir sembolün (diff içi ya da dışı) konumu. */
export interface SymbolLocation {
  id: string;
  kind: SymbolKind;
  name: string;
  signature?: string;
  path: string;
  side: 'old' | 'new'; // silinmiş semboller 'old'
  range: Range;
  inDiff: boolean; // dosya bu review'un değişen dosyalarından biri mi
  typeId?: string; // sembolün ait olduğu (ya da kendisi olan) tip id'si
}

// ---------------------------------------------------------------------------
// Klasör seçici (Tur 5): yerel repo yolunu seçmek için sunucu tarafı dizin listesi
// ---------------------------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string; // mutlak, platformun ayırıcısıyla
  isGitRepo: boolean; // doğrudan altında .git (klasör ya da dosya) var
  hidden: boolean; // nokta ile başlayan ya da Windows gizli özniteliği
}

export interface FsRoot {
  label: string; // 'Ev', 'Belgeler', 'C:', 'Masaüstü', 'Çalışma dizini'
  path: string;
  kind: 'home' | 'drive' | 'special' | 'cwd';
}

export interface FsListing {
  path: string; // normalize edilmiş mutlak yol
  parent?: string; // kökte undefined
  isGitRepo: boolean;
  /** Bu yol bir git deposunun içindeyse (alt klasörüyse) deponun kökü. */
  repoRoot?: string;
  entries: FsEntry[]; // yalnızca klasörler, ada göre sıralı (git repoları önce değil, alfabetik)
  roots: FsRoot[];
  truncated: boolean; // çok fazla girdi varsa ilk N döner
}

/*
 * Uç noktalar (hepsi JSON):
 *   GET  /api/config                                   -> AppConfig
 *   GET  /api/git/refs?repoPath=...                    -> GitRefs
 *   GET  /api/fs/list?path=...&hidden=0|1             -> FsListing      (path boşsa ev dizini; yalnız klasör adları, dosya içeriği okunmaz)
 *   POST /api/reviews            body: ReviewRequest   -> ReviewModel   (hata: 4xx/5xx ApiError)  [senkron]
 *   POST /api/jobs               body: ReviewRequest   -> ReviewJob     (202; doğrulama hatası 400 ApiError)
 *   GET  /api/jobs/:id                                 -> ReviewJob     (arayüz ~400 ms aralıkla sorgular)
 *   DELETE /api/reviews/:id                            -> { ok: true }
 *   GET  /api/reviews                                  -> ReviewListItem[]
 *   GET  /api/reviews/:id                              -> ReviewModel
 *   GET  /api/reviews/:id/file?path=...&side=old|new   -> { path: string; side: 'old'|'new'; content: string | null }
 *        (diff dışındaki repo dosyaları da: head/base ağacından okunur)
 *   GET  /api/reviews/:id/outline?path=...&side=old|new -> FileOutline   (Java değilse decls/refs boş; dosya yoksa 404)
 *   GET  /api/reviews/:id/locate?id=<sembol id>        -> SymbolLocation (bulunamazsa 404)
 */

/**
 * Core iç sözleşmesi: Java ayrıştırma modeli + semantik diff + repo indeksi.
 * Üreten: şerit A1 (parser/extract/semanticDiff/repoIndex)
 * Tüketen: şerit A2 (risk, katman, mimari, test eşleme, gruplama, plan, graf, buildReview)
 */
import type {
  CallRef,
  MemberChange,
  MemberKind,
  Range,
  TypeChange,
  TypeKind,
} from '../../shared/types.js';

export type Visibility = 'public' | 'protected' | 'package' | 'private';

export interface JavaParam {
  name: string;
  type: string; // kaynakta yazıldığı gibi: 'List<Order>', 'int[]', 'String...'
  varargs: boolean;
}

export type ReceiverKind =
  | 'none' // foo()
  | 'this' // this.foo()
  | 'super' // super.foo()
  | 'identifier' // repo.foo()  (yerel değişken / parametre / alan / tip adı olabilir)
  | 'field-access' // this.repo.foo(), a.b.foo()
  | 'expression'; // getX().foo(), new A().foo(), (cast).foo()

export interface CallSite {
  name: string; // çağrılan metot adı; yapıcı çağrısında tip adı
  argCount: number;
  receiver?: string; // alıcı ifadenin ham metni
  receiverKind: ReceiverKind;
  line: number; // 1 tabanlı
  isConstructor: boolean; // new X(...) ise true, name = 'X'
  isMethodRef: boolean; // Type::method ise true (argCount = -1)
  /**
   * Argüman ifadelerinin boşlukları tek boşluğa indirilmiş ham metni (en fazla 80 karakter, uzunsa kırpılır).
   * Metot referansında yok. Tip çıkarımı (literal, yerel değişken) için; eski çağrı/yeni imza uyuşmazlığı tespitinde kullanılır.
   */
  args?: string[];
}

export interface CodeFeatures {
  catches: number;
  emptyCatches: number;
  throwsNew: number;
  synchronizedBlocks: number;
  sqlStrings: number; // SELECT/INSERT/UPDATE/DELETE içeren string literal
  printStackTrace: number;
  systemOut: number;
  todos: number; // TODO/FIXME yorumları
  nullChecks: number; // '== null' / '!= null' / Objects.requireNonNull / Optional
  returnsNull: number;
}

export interface JavaMember {
  kind: MemberKind;
  name: string; // yapıcı: tip adı; initializer: '<init>' veya '<clinit>'
  /**
   * Kararlı sembol id'si:
   *  - metot/yapıcı: `${ownerFqn}#${name}(${paramTypesErased.join(',')})`  ör. 'com.acme.OrderService#place(Order,int)'
   *    (parametre tipi: generic argümanlar silinmiş, paket öneki atılmış basit ad; dizi '[]', varargs '...' korunur)
   *  - alan / enum sabiti: `${ownerFqn}#${name}`
   *  - initializer: `${ownerFqn}#<clinit>#${sira}` veya `#<init>#${sira}`
   */
  id: string;
  ownerFqn: string;
  params: JavaParam[];
  returnType?: string; // metot
  fieldType?: string; // alan
  throws: string[];
  modifiers: string[]; // 'public','static','final','abstract','synchronized','default',...
  annotations: string[]; // argümanlarıyla: '@Transactional(readOnly = true)'
  typeParams?: string; // '<T extends Foo>'
  visibility: Visibility; // arayüz üyeleri varsayılan public
  range: Range; // javadoc hariç bildirim aralığı
  javadoc?: string;
  javadocRange?: Range;
  signature: string; // okunur: 'public Order place(Order order, int qty) throws X'
  text: string; // bildirimin ham kaynak metni (javadoc hariç)
  /** Yorumlar ve tüm boşluklar atılmış gövde metni (eşitlik/benzerlik için). Gövdesizse ''. */
  normalizedBody: string;
  /** Yorumlar atılmış, boşluklar tek boşluğa indirilmiş tam bildirim (cosmetic tespiti için). */
  normalizedText: string;
  callSites: CallSite[]; // lambda ve anonim sınıf içindekiler dahil
  localTypes: Record<string, string>; // ad -> tip (parametreler + yerel değişkenler; 'var' ise başlatıcıdan çıkarılabildiyse)
  complexity: number; // yaklaşık siklomatik karmaşıklık (1 + dallanmalar)
  features: CodeFeatures;
  initializerText?: string; // alan başlatıcısı
}

export interface JavaType {
  fqn: string; // iç tip: 'com.acme.Outer.Inner'
  name: string;
  kind: TypeKind;
  modifiers: string[];
  annotations: string[];
  visibility: Visibility;
  typeParams?: string;
  superclass?: string; // ham ad (generic silinmiş): 'AbstractNotifier'
  interfaces: string[]; // ham adlar (generic silinmiş)
  range: Range;
  javadoc?: string;
  members: JavaMember[];
  outerFqn?: string;
  nestedTypeFqns: string[];
  fieldTypes: Record<string, string>; // alan adı -> tip (kalıtılanlar hariç)
  normalizedText: string; // yorum/boşluk normalize edilmiş tüm tip metni
}

export interface JavaImport {
  name: string; // 'com.acme.Order', 'com.acme' (wildcard ise paket), statik ise 'com.acme.Util.max'
  static: boolean;
  wildcard: boolean;
  line: number;
}

export interface JavaFileModel {
  path: string;
  packageName: string; // varsayılan pakette ''
  imports: JavaImport[];
  types: JavaType[]; // iç tipler dahil düz liste
  hasErrors: boolean; // tree-sitter ERROR/MISSING düğümü var mı
  errorLines: number[];
  lineCount: number;
  /** importlar hariç, yorum/boşluk normalize edilmiş dosya metni. */
  normalizedCode: string;
}

// ---------------------------------------------------------------------------
// Semantik diff çıktısı (A1 üretir, A2 zenginleştirir)
// ---------------------------------------------------------------------------

export interface MemberDiff {
  /** risk: {score:0, level:'low', reasons:[]} ve callers/callees/overrides/overriddenBy boş dizi olarak gelir; A2 doldurur. */
  change: MemberChange;
  oldMember?: JavaMember;
  newMember?: JavaMember;
}

export interface TypeDiff {
  /** change.members === members.map(m => m.change) (aynı nesne referansları). risk ve subTypes A2'de doldurulur. */
  change: TypeChange;
  oldType?: JavaType;
  newType?: JavaType;
  members: MemberDiff[];
  oldFile?: JavaFileModel;
  newFile?: JavaFileModel;
}

// ---------------------------------------------------------------------------
// Fonksiyon sözleşmeleri (A1 uygular)
// ---------------------------------------------------------------------------

/** src/core/java/parser.ts */
export type ParseJavaFile = (path: string, source: string) => Promise<JavaFileModel>;

/**
 * src/core/java/semanticDiff.ts
 * diffJavaFile(oldModel, newModel, { oldPath, newPath }): TypeDiff[]
 *  - Eklenen dosyada oldModel undefined, silinende newModel undefined.
 *  - Değişmeyen tipler de döner (status 'unchanged'), üyeleri dahil.
 *
 * detectCrossFileMoves(diffs: TypeDiff[]): void
 *  - Farklı tip/dosyalardaki removed + added üye çiftlerini gövde benzerliğiyle eşler (>= 0.85),
 *    ikisini tek MemberDiff'e indirger: status 'moved', oldId eski id. Yerinde değiştirir.
 *
 * memberSimilarity(a: JavaMember, b: JavaMember): number   // 0..1
 */

/** src/core/java/repoIndex.ts */
export interface ResolvedMember {
  member: JavaMember;
  type: JavaType;
  file: JavaFileModel;
}

export interface RepoIndexApi {
  readonly files: ReadonlyMap<string, JavaFileModel>; // path -> model
  getType(fqn: string): JavaType | undefined;
  getFileOfType(fqn: string): JavaFileModel | undefined;
  getMember(id: string): ResolvedMember | undefined;
  /** Bir dosya/tip bağlamında tip adını FQN'e çözer (iç tip, import, aynı paket, wildcard, java.lang). */
  resolveTypeName(name: string, fromFile: JavaFileModel, fromType?: JavaType): string | undefined;
  superTypesOf(fqn: string): string[]; // doğrudan; çözülemeyen ham ad olarak
  subTypesOf(fqn: string, transitive?: boolean): string[];
  /** Bu metodun üst tiplerde (geçişli) override ettiği metot id'leri. */
  overridesOf(memberId: string): string[];
  /** Alt tiplerde (geçişli) bu metodu override eden metot id'leri. */
  overriddenBy(memberId: string): string[];
  /** Head tarafında bu sembolü çağıranlar. inChangedCode her zaman false döner; A2 düzeltir. */
  callersOf(memberId: string): CallRef[];
  calleesOf(memberId: string): string[];
  /** Silinmiş/yeniden adlandırılmış üyeler için: owner tipi (ve alt tipleri) üzerinde name/argCount ile çağrılar. */
  findCallsTo(ownerFqn: string, name: string, argCount?: number): CallRef[];
  /** Tipi import eden veya basit adıyla kullanan dosyalar. */
  filesReferencingType(fqn: string): string[];
}

/**
 * src/core/java/repoIndex.ts
 * export class RepoIndex implements RepoIndexApi { static build(files: JavaFileModel[]): RepoIndex }
 */

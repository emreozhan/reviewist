/**
 * Java kaynağını sembol modeline (JavaFileModel) çevirir.
 * Tüm normalizasyonlar tree-sitter yaprak düğümlerinden üretilir; string literal içerikleri korunur.
 */
import type { Node } from 'web-tree-sitter';
import type { MemberKind, Range, TypeKind } from '../../shared/types.js';
import type {
  AnonymousClassInfo,
  CallSite,
  CodeFeatures,
  JavaFileModel,
  JavaImport,
  JavaMember,
  JavaParam,
  JavaType,
  ReceiverKind,
  Visibility,
} from './model.js';
import { baseTypeName, collapseWs, eraseTypeForId, HAS_LOWER_RE, ID_PART_CHARS, IDENT, simpleName, stripTypeArgs } from './names.js';
import { maskedTokens, maskVarargsAnnotations } from './mask.js';
import { getJavaParser } from './parser.js';
import { TYPE_REF_ANNOTATION, TYPE_REF_EXPR, TypeRefTableBuilder } from './typeRefTable.js';

// ---------------------------------------------------------------------------
// Token / yorum toplama
// ---------------------------------------------------------------------------

interface Tok {
  s: number;
  e: number;
  t: string;
}

interface Cmt {
  s: number;
  e: number;
  t: string;
}

const ATOMIC_TOKENS = new Set(['string_literal', 'character_literal']);
const COMMENT_TYPES = new Set(['line_comment', 'block_comment']);

/** Büyük harfle başlayan Java tanımlayıcısı (Unicode: `Ödeme`). */
const UPPER_IDENT = new RegExp(`^\\p{Lu}[${ID_PART_CHARS}]*$`, 'u');
const HAS_LOWER = HAS_LOWER_RE;

/** Satır/sütun (sütun satır içi 0 tabanlı UTF-16 kod birimi). */
interface Pos {
  line: number;
  col: number;
}

/** Tip tanımlayıcısı düğümü (kod gezinme için; düğüm nesnesi oluşturulmaz). */
interface TypeIdEvent {
  s: number;
  e: number;
  scoped: boolean;
}

/** Analiz için tek geçişte kaydedilen düğüm (önsıralı; başlangıca göre artan). */
interface NodeEvent {
  s: number;
  e: number;
  type: string;
  node?: Node; // yalnız INTERESTING tipler için
}

class FileCtx {
  readonly toks: Tok[] = [];
  readonly cmts: Cmt[] = [];
  readonly events: NodeEvent[] = [];
  /** type_identifier / scoped_type_identifier düğümleri (önsıralı). */
  readonly typeIds: TypeIdEvent[] = [];
  private lineStarts: number[] | undefined;

  constructor(readonly src: string) {}

  /** Kaynak konumunun (UTF-16 indeks) satırı (1 tabanlı) ve satır içi sütunu (0 tabanlı UTF-16). */
  pos(index: number): Pos {
    if (!this.lineStarts) {
      const ls = [0];
      for (let i = this.src.indexOf('\n'); i >= 0; i = this.src.indexOf('\n', i + 1)) ls.push(i + 1);
      this.lineStarts = ls;
    }
    const ls = this.lineStarts;
    let lo = 0;
    let hi = ls.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((ls[mid] as number) <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: index - (ls[lo] as number) };
  }

  /** Tek ağaç geçişi: tokenlar, yorumlar ve analiz olayları. */
  collect(root: Node): void {
    const c = root.walk();
    try {
      let descend = true;
      for (;;) {
        if (descend) {
          const type = c.nodeType;
          const s = c.startIndex;
          const e = c.endIndex;
          if (INTERESTING.has(type)) this.events.push({ s, e, type, node: c.currentNode });
          else if (COUNTED.has(type)) this.events.push({ s, e, type });
          else if (type === 'type_identifier') this.typeIds.push({ s, e, scoped: false });
          else if (type === 'scoped_type_identifier') this.typeIds.push({ s, e, scoped: true });
          if (COMMENT_TYPES.has(type)) {
            this.cmts.push({ s, e, t: this.src.slice(s, e) });
          } else if (ATOMIC_TOKENS.has(type)) {
            this.toks.push({ s, e, t: this.src.slice(s, e) });
          } else if (c.gotoFirstChild()) {
            continue;
          } else if (e > s) {
            this.toks.push({ s, e, t: this.src.slice(s, e) });
          }
        }
        if (c.gotoNextSibling()) {
          descend = true;
          continue;
        }
        if (!c.gotoParent()) break;
        descend = false;
      }
    } finally {
      c.delete();
    }
  }

  /** Maskelenmiş (ayrıştırıcıya gösterilmemiş) metnin tokenlarını ekler; konum sırası korunur. */
  addTokens(extra: Tok[]): void {
    if (extra.length === 0) return;
    this.toks.push(...extra);
    this.toks.sort((a, b) => a.s - b.s);
  }

  private anonBodiesCache: Node[] | undefined;

  /** Anonim sınıf gövdeleri (`new X() { ... }` içindeki class_body), başlangıca göre sıralı. */
  anonBodies(): Node[] {
    if (!this.anonBodiesCache) {
      const out: Node[] = [];
      for (const ev of this.events) {
        if (ev.type !== 'object_creation_expression' || !ev.node) continue;
        const body = childOfType(ev.node, 'class_body');
        if (body) out.push(body);
      }
      out.sort((a, b) => a.startIndex - b.startIndex);
      this.anonBodiesCache = out;
    }
    return this.anonBodiesCache;
  }

  private hasAnonIn(s: number, e: number): boolean {
    const bodies = this.anonBodies();
    if (bodies.length === 0) return false;
    let lo = 0;
    let hi = bodies.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((bodies[mid] as Node).startIndex < s) lo = mid + 1;
      else hi = mid;
    }
    const b = bodies[lo];
    return !!b && b.endIndex <= e;
  }

  /**
   * Anonim sınıf gövdelerindeki üyeleri sıralanmış (kanonik) token metni: c = boşluksuz, n = tek boşluklu.
   * Üye sırası değişimi gövde/başlatıcı değişikliği sayılmasın diye.
   */
  private canon(s: number, e: number): { c: string; n: string } {
    const bodies = this.anonBodies().filter((b) => b.startIndex >= s && b.endIndex <= e);
    const cs: string[] = [];
    const ns: string[] = [];
    let ti = this.lowerBound(this.toks, s);
    let bi = 0;
    while (ti < this.toks.length) {
      const t = this.toks[ti] as Tok;
      if (t.e > e) break;
      const b = bodies[bi];
      if (b && t.s >= b.startIndex) {
        const chunks = namedNonComment(b).map((m) => this.canon(m.startIndex, m.endIndex));
        chunks.sort((x, y) => (x.c < y.c ? -1 : x.c > y.c ? 1 : 0));
        cs.push(`{${chunks.map((x) => x.c).join('')}}`);
        ns.push(['{', ...chunks.map((x) => x.n).filter((x) => x), '}'].join(' '));
        while (ti < this.toks.length && (this.toks[ti] as Tok).s < b.endIndex) ti++;
        while (bi < bodies.length && (bodies[bi] as Node).startIndex < b.endIndex) bi++;
        continue;
      }
      if (b && t.s >= b.endIndex) {
        bi++;
        continue;
      }
      cs.push(t.t);
      ns.push(t.t);
      ti++;
    }
    return { c: cs.join(''), n: ns.join(' ') };
  }

  eventsIn(s: number, e: number): NodeEvent[] {
    const out: NodeEvent[] = [];
    for (let i = this.lowerBound(this.events, s); i < this.events.length; i++) {
      const ev = this.events[i] as NodeEvent;
      if (ev.s >= e) break;
      if (ev.e <= e) out.push(ev);
    }
    return out;
  }

  private lowerBound<T extends { s: number }>(arr: T[], pos: number): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((arr[mid] as T).s < pos) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  tokens(s: number, e: number): string[] {
    const out: string[] = [];
    for (let i = this.lowerBound(this.toks, s); i < this.toks.length; i++) {
      const t = this.toks[i] as Tok;
      if (t.e > e) break;
      out.push(t.t);
    }
    return out;
  }

  /** Yorumsuz, tokenlar tek boşlukla birleştirilmiş metin. */
  norm(s: number, e: number): string {
    if (this.hasAnonIn(s, e)) return this.canon(s, e).n;
    return this.tokens(s, e).join(' ');
  }

  /** Yorumsuz, tüm boşluklar atılmış metin (string içerikleri korunur). */
  compact(s: number, e: number): string {
    if (this.hasAnonIn(s, e)) return this.canon(s, e).c;
    return this.tokens(s, e).join('');
  }

  /** Büyük harfle başlayan tanımlayıcı tokenları (olası tip referansları); önünde '.' olan TAMAMI_BÜYÜK sabitler hariç. */
  typeRefs(): string[] {
    const out = new Set<string>();
    let prev = '';
    for (const t of this.toks) {
      const x = t.t;
      if (UPPER_IDENT.test(x)) {
        if (!(prev === '.' && !HAS_LOWER.test(x))) out.add(x);
      }
      prev = x;
    }
    return [...out];
  }

  /**
   * Tip referansı konumları: tip konumundaki tanımlayıcılar (alan/parametre/dönüş/yerel tipleri, extends/implements,
   * `new X`, cast, `X.class`, generic argümanları, throws, catch) + tokenlardan ifade konumundaki büyük harfli adlar
   * (`Foo.bar()`, `Foo.CONST`, `Foo::x` alıcısı; `Outer.Inner.x()` zinciri) ve anotasyon adları (maskelenenler dahil).
   */
  typeRefTable(): ReturnType<TypeRefTableBuilder['build']> {
    const refs: { s: number; e: number; name: string; flags: number }[] = [];
    const seen = new Set<number>();
    const ids = this.typeIds;
    let i = 0;
    while (i < ids.length) {
      const x = ids[i] as TypeIdEvent;
      if (!x.scoped) {
        const text = this.src.slice(x.s, x.e);
        if (UPPER_IDENT.test(text)) refs.push({ s: x.s, e: x.e, name: text, flags: 0 });
        seen.add(x.s);
        i++;
        continue;
      }
      // en dıştaki nitelikli tip: içindeki tanımlayıcılar '.' ile zincirlenir (paket parçaları küçük harfli, atlanır)
      let j = i + 1;
      const chain: string[] = [];
      let prevEnd = -1;
      for (; j < ids.length && (ids[j] as TypeIdEvent).s < x.e; j++) {
        const sg = ids[j] as TypeIdEvent;
        if (sg.scoped) continue;
        const text = this.src.slice(sg.s, sg.e);
        if (chain.length && this.src.slice(prevEnd, sg.s).trim() !== '.') chain.length = 0;
        chain.push(text);
        prevEnd = sg.e;
        seen.add(sg.s);
        if (UPPER_IDENT.test(text)) refs.push({ s: sg.s, e: sg.e, name: chain.join('.'), flags: 0 });
      }
      i = j;
    }
    const toks = this.toks;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k] as Tok;
      if (seen.has(t.s) || !UPPER_IDENT.test(t.t)) continue;
      const prev = toks[k - 1]?.t;
      if (prev === '@') {
        refs.push({ s: t.s, e: t.e, name: t.t, flags: TYPE_REF_ANNOTATION });
        continue;
      }
      if (prev === '.' || !HAS_LOWER.test(t.t)) continue;
      const next = toks[k + 1]?.t;
      if (next !== '.' && next !== '::') continue;
      refs.push({ s: t.s, e: t.e, name: t.t, flags: TYPE_REF_EXPR });
      // Outer.Inner.x() zinciri
      let name = t.t;
      let m = k;
      for (;;) {
        const seg = toks[m + 2];
        const after = toks[m + 3]?.t;
        if (toks[m + 1]?.t !== '.' || !seg || !UPPER_IDENT.test(seg.t) || !HAS_LOWER.test(seg.t) || (after !== '.' && after !== '::')) break;
        name = `${name}.${seg.t}`;
        refs.push({ s: seg.s, e: seg.e, name, flags: TYPE_REF_EXPR });
        seen.add(seg.s);
        m += 2;
      }
    }
    refs.sort((a, b) => a.s - b.s);
    const b = new TypeRefTableBuilder();
    for (const r of refs) {
      const p = this.pos(r.s);
      b.add(r.name, p.line, p.col, p.col + (r.e - r.s), r.flags);
    }
    return b.build();
  }

  comments(s: number, e: number): Cmt[] {
    const out: Cmt[] = [];
    for (let i = this.lowerBound(this.cmts, s); i < this.cmts.length; i++) {
      const c = this.cmts[i] as Cmt;
      if (c.e > e) break;
      out.push(c);
    }
    return out;
  }

  slice(n: Node): string {
    return this.src.slice(n.startIndex, n.endIndex);
  }

  /** Düğümün satır başındaki girintisi (önünde yalnız boşluk varsa), yoksa ''. */
  indentBefore(start: number): string {
    const ls = this.src.lastIndexOf('\n', start - 1) + 1;
    const prefix = this.src.slice(ls, start);
    return /^[ \t]*$/.test(prefix) ? prefix : '';
  }

  /** Ham bildirim metni; ilk satırın girintisi dahil (yeniden girintileme kozmetik olarak yakalansın). */
  lineSlice(n: Node): string {
    return this.indentBefore(n.startIndex) + this.slice(n);
  }
}

// ---------------------------------------------------------------------------
// Düğüm yardımcıları
// ---------------------------------------------------------------------------

const TYPE_KINDS: Record<string, TypeKind> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  record_declaration: 'record',
  annotation_type_declaration: 'annotation',
};

function rangeOf(n: Node): Range {
  return { startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1 };
}

function childOfType(n: Node, type: string): Node | null {
  for (const ch of n.children) {
    if (ch && ch.type === type) return ch;
  }
  return null;
}

function namedNonComment(n: Node): Node[] {
  const out: Node[] = [];
  for (const ch of n.namedChildren) {
    if (ch && !COMMENT_TYPES.has(ch.type)) out.push(ch);
  }
  return out;
}

function argCountOf(args: Node | null): number {
  return args ? namedNonComment(args).length : 0;
}

const MAX_ARG_TEXT = 80;

/** Argüman ifadelerinin kısaltılmış metinleri (tip çıkarımı için). */
function argTextsOf(ctx: FileCtx, args: Node | null): string[] {
  if (!args) return [];
  return namedNonComment(args).map((a) => {
    const t = collapseWs(ctx.slice(a));
    return t.length > MAX_ARG_TEXT ? `${t.slice(0, MAX_ARG_TEXT)}…` : t;
  });
}

function emptyFeatures(): CodeFeatures {
  return {
    catches: 0,
    emptyCatches: 0,
    throwsNew: 0,
    synchronizedBlocks: 0,
    sqlStrings: 0,
    printStackTrace: 0,
    systemOut: 0,
    todos: 0,
    nullChecks: 0,
    returnsNull: 0,
  };
}

const SQL_VERB_RE = /\b(?:select|insert|update|delete)\b/i;
const SQL_CLAUSE_RE = /\b(?:from|into|set|where)\b/gi;

/**
 * Literal SQL içeriyor mu: bir SQL fiilinden (select/insert/update/delete) sonra from/into/set/where geçiyor.
 * İki doğrusal arama (tek desenle `fiil[\s\S]*yan_cümle` uzun girdide ikinci dereceden geri izleme yapar).
 */
export function looksLikeSql(text: string): boolean {
  const verb = SQL_VERB_RE.exec(text);
  if (!verb) return false;
  SQL_CLAUSE_RE.lastIndex = verb.index + verb[0].length;
  return SQL_CLAUSE_RE.test(text);
}
const TODO_RE = /\b(TODO|FIXME)\b/;

interface Analysis {
  callSites: CallSite[];
  localTypes: Record<string, string>;
  complexity: number;
  features: CodeFeatures;
}

interface OwnerInfo {
  simpleName: string;
  superSimpleName?: string;
}

function receiverKindOf(obj: Node | null): ReceiverKind {
  if (!obj) return 'none';
  switch (obj.type) {
    case 'this':
      return 'this';
    case 'super':
      return 'super';
    case 'identifier':
      return 'identifier';
    case 'field_access':
    case 'scoped_identifier': {
      const f = obj.childForFieldName('field');
      if (f?.type === 'this') return 'this';
      if (f?.type === 'super') return 'super';
      return 'field-access';
    }
    default:
      return 'expression';
  }
}

function methodRefReceiverKind(n: Node | null): ReceiverKind {
  if (!n) return 'expression';
  switch (n.type) {
    case 'this':
      return 'this';
    case 'super':
      return 'super';
    case 'identifier':
    case 'type_identifier':
    case 'generic_type':
    case 'scoped_type_identifier':
      return 'identifier';
    case 'field_access':
    case 'scoped_identifier':
      return 'field-access';
    default:
      return 'expression';
  }
}

function addLocal(a: Analysis, name: string | undefined, type: string | undefined): void {
  if (!name || !type || type === 'var') return;
  if (!(name in a.localTypes)) a.localTypes[name] = type;
}

/** `var x = <değer>` için tip çıkarımı. */
function inferVarType(ctx: FileCtx, value: Node | null): string | undefined {
  if (!value) return undefined;
  switch (value.type) {
    case 'object_creation_expression': {
      const t = value.childForFieldName('type');
      return t ? stripTypeArgs(ctx.slice(t)) : undefined;
    }
    case 'cast_expression': {
      const t = value.childForFieldName('type');
      return t ? collapseWs(ctx.slice(t)) : undefined;
    }
    case 'array_creation_expression': {
      const t = value.childForFieldName('type');
      if (!t) return undefined;
      let dims = 0;
      for (const ch of namedNonComment(value)) {
        if (ch.type === 'dimensions_expr') dims++;
        else if (ch.type === 'dimensions') dims += (ch.text.match(/\[/g) ?? []).length;
      }
      return `${collapseWs(ctx.slice(t))}${'[]'.repeat(Math.max(1, dims))}`;
    }
    case 'string_literal':
      return 'String';
    default:
      return undefined;
  }
}

const INTERESTING = new Set([
  'method_invocation',
  'object_creation_expression',
  'method_reference',
  'explicit_constructor_invocation',
  'formal_parameter',
  'spread_parameter',
  'local_variable_declaration',
  'enhanced_for_statement',
  'catch_formal_parameter',
  'instanceof_expression',
  'record_pattern_component',
  'type_pattern',
  'resource',
  'switch_label',
  'catch_clause',
  'binary_expression',
  'throw_statement',
  'string_literal',
  'return_statement',
]);

/** Düğüm nesnesi gerekmeyen sayımlar: dallanmalar (karmaşıklık) ve synchronized blokları. */
const COUNTED = new Set([
  'if_statement',
  'for_statement',
  'while_statement',
  'do_statement',
  'ternary_expression',
  'synchronized_statement',
]);

/** `Objects` üzerinde null güvenli / null denetleyen metotlar. */
const NULL_SAFE_OBJECTS = new Set([
  'requireNonNull',
  'requireNonNullElse',
  'requireNonNullElseGet',
  'hashCode',
  'equals',
  'toString',
  'isNull',
  'nonNull',
  'hash',
]);
/** Statik import ile alıcısız çağrılabilen (adı tek başına anlamlı) null denetimleri. */
const NULL_CHECK_UNQUALIFIED = new Set(['requireNonNull', 'requireNonNullElse', 'requireNonNullElseGet', 'isNull', 'nonNull']);

/** Null denetimi sayılan çağrı mı: Objects.* (yukarıdaki), Optional.* (ofNullable dahil), statik importlu requireNonNull vb. */
function isNullCheckCall(objText: string | undefined, name: string): boolean {
  if (objText === undefined) return NULL_CHECK_UNQUALIFIED.has(name);
  if (objText === 'Objects' || objText === 'java.util.Objects') return NULL_SAFE_OBJECTS.has(name);
  return objText === 'Optional' || objText === 'java.util.Optional';
}

/** Çağrı yerine ad tanımlayıcısının konumunu yazar ([s, e) kaynak indeksleri; tek satırlık ad varsayılır). */
function setSiteName(ctx: FileCtx, site: CallSite, s: number, e: number): void {
  const p = ctx.pos(s);
  site.col = p.col;
  site.endCol = p.col + (e - s);
  if (p.line !== site.line) site.nameLine = p.line;
}

const LAST_IDENT = new RegExp(`(${IDENT})\\s*$`, 'u');

/** `new a.b.Foo<X>()` tip düğümünde basit tip adının [s, e) aralığı. */
function typeNameSpan(ctx: FileCtx, t: Node): { s: number; e: number } | undefined {
  const text = ctx.slice(t);
  const lt = text.indexOf('<');
  const head = lt >= 0 ? text.slice(0, lt) : text;
  const m = LAST_IDENT.exec(head);
  if (!m || m[1] === undefined) return undefined;
  const s = t.startIndex + m.index;
  return { s, e: s + m[1].length };
}

function visitNode(n: Node, ctx: FileCtx, a: Analysis, owner: OwnerInfo): void {
  switch (n.type) {
    case 'method_invocation': {
      const nameNode = n.childForFieldName('name');
      const obj = n.childForFieldName('object');
      const name = nameNode ? ctx.slice(nameNode) : '';
      const args = n.childForFieldName('arguments');
      const site: CallSite = {
        name,
        argCount: argCountOf(args),
        receiverKind: receiverKindOf(obj),
        line: (nameNode ?? n).startPosition.row + 1,
        isConstructor: false,
        isMethodRef: false,
        args: argTextsOf(ctx, args),
      };
      if (nameNode) setSiteName(ctx, site, nameNode.startIndex, nameNode.endIndex);
      const objText = obj ? collapseWs(ctx.slice(obj)).replace(/\s*\.\s*/g, '.') : undefined;
      if (objText !== undefined) site.receiver = objText;
      a.callSites.push(site);
      if (name === 'printStackTrace') a.features.printStackTrace++;
      if (objText === 'System.out' || objText === 'System.err') a.features.systemOut++;
      if (isNullCheckCall(objText, name)) a.features.nullChecks++;
      return;
    }
    case 'object_creation_expression': {
      const t = n.childForFieldName('type');
      const args = n.childForFieldName('arguments');
      const obj = n.childForFieldName('object') ?? null;
      const site: CallSite = {
        name: t ? baseTypeName(ctx.slice(t)) : '',
        argCount: argCountOf(args),
        receiverKind: obj ? receiverKindOf(obj) : 'none',
        line: n.startPosition.row + 1,
        isConstructor: true,
        isMethodRef: false,
        args: argTextsOf(ctx, args),
      };
      if (obj) site.receiver = collapseWs(ctx.slice(obj));
      const span = t ? typeNameSpan(ctx, t) : undefined;
      if (span) setSiteName(ctx, site, span.s, span.e);
      a.callSites.push(site);
      return;
    }
    case 'method_reference': {
      const kids = namedNonComment(n);
      const recv = kids[0] ?? null;
      let isCtor = false;
      let newNode: Node | null = null;
      for (const ch of n.children) {
        if (ch?.type === 'new') {
          isCtor = true;
          newNode = ch;
        }
      }
      const last = kids.length > 1 ? kids[kids.length - 1] : undefined;
      const recvText = recv ? collapseWs(ctx.slice(recv)) : '';
      const site: CallSite = {
        name: isCtor ? baseTypeName(recvText) : last ? ctx.slice(last) : '',
        argCount: -1,
        receiverKind: methodRefReceiverKind(recv),
        line: n.startPosition.row + 1,
        isConstructor: isCtor,
        isMethodRef: true,
      };
      if (recvText) site.receiver = recvText;
      const nameAt = isCtor ? newNode : (last ?? null);
      if (nameAt) setSiteName(ctx, site, nameAt.startIndex, nameAt.endIndex);
      a.callSites.push(site);
      if (recvText === 'System.out' || recvText === 'System.err') a.features.systemOut++;
      if (!isCtor && (recvText === 'Objects' || recvText === 'java.util.Objects') && NULL_SAFE_OBJECTS.has(site.name)) {
        a.features.nullChecks++;
      }
      return;
    }
    case 'explicit_constructor_invocation': {
      const ctor = n.childForFieldName('constructor');
      const isSuper = ctor?.type === 'super';
      const args = n.childForFieldName('arguments');
      const site: CallSite = {
        name: isSuper ? (owner.superSimpleName ?? 'super') : owner.simpleName,
        argCount: argCountOf(args),
        receiverKind: isSuper ? 'super' : 'this',
        receiver: isSuper ? 'super' : 'this',
        line: n.startPosition.row + 1,
        isConstructor: true,
        isMethodRef: false,
        args: argTextsOf(ctx, args),
      };
      if (ctor) setSiteName(ctx, site, ctor.startIndex, ctor.endIndex);
      a.callSites.push(site);
      return;
    }
    case 'formal_parameter': {
      const t = n.childForFieldName('type');
      const nm = n.childForFieldName('name');
      const dims = n.childForFieldName('dimensions');
      if (t && nm) addLocal(a, ctx.slice(nm), collapseWs(ctx.slice(t)) + (dims ? collapseWs(ctx.slice(dims)) : ''));
      return;
    }
    case 'spread_parameter': {
      const p = readSpread(ctx, n);
      if (p) addLocal(a, p.name, p.type);
      return;
    }
    case 'local_variable_declaration': {
      const t = n.childForFieldName('type');
      const typeText = t ? collapseWs(ctx.slice(t)) : undefined;
      for (const d of n.childrenForFieldName('declarator')) {
        if (!d) continue;
        const nm = d.childForFieldName('name');
        if (!nm) continue;
        const dims = d.childForFieldName('dimensions');
        let ty = typeText;
        if (ty === 'var') ty = inferVarType(ctx, d.childForFieldName('value'));
        else if (ty && dims) ty += collapseWs(ctx.slice(dims));
        addLocal(a, ctx.slice(nm), ty);
      }
      return;
    }
    case 'enhanced_for_statement': {
      a.complexity++;
      const t = n.childForFieldName('type');
      const nm = n.childForFieldName('name');
      if (t && nm) addLocal(a, ctx.slice(nm), collapseWs(ctx.slice(t)));
      return;
    }
    case 'catch_formal_parameter': {
      const ct = childOfType(n, 'catch_type');
      const nm = n.childForFieldName('name');
      const first = ct ? namedNonComment(ct)[0] : undefined;
      if (first && nm) addLocal(a, ctx.slice(nm), collapseWs(ctx.slice(first)));
      return;
    }
    case 'instanceof_expression': {
      const t = n.childForFieldName('right');
      const nm = n.childForFieldName('name');
      if (t && nm) addLocal(a, ctx.slice(nm), collapseWs(ctx.slice(t)));
      return;
    }
    case 'record_pattern_component':
    case 'type_pattern': {
      const kids = namedNonComment(n);
      const nm = kids[kids.length - 1];
      const t = kids.length >= 2 ? kids[kids.length - 2] : undefined;
      if (t && nm && nm.type === 'identifier') addLocal(a, ctx.slice(nm), collapseWs(ctx.slice(t)));
      return;
    }
    case 'resource': {
      const t = n.childForFieldName('type');
      const nm = n.childForFieldName('name');
      if (t && nm) {
        const tt = collapseWs(ctx.slice(t));
        addLocal(a, ctx.slice(nm), tt === 'var' ? inferVarType(ctx, n.childForFieldName('value')) : tt);
      }
      return;
    }
    case 'switch_label': {
      if (n.child(0)?.type === 'case') a.complexity++;
      return;
    }
    case 'catch_clause': {
      a.complexity++;
      a.features.catches++;
      const body = n.childForFieldName('body');
      if (body && namedNonComment(body).length === 0) a.features.emptyCatches++;
      return;
    }
    case 'binary_expression': {
      const op = n.childForFieldName('operator')?.type;
      if (op === '&&' || op === '||') a.complexity++;
      else if (op === '==' || op === '!=') {
        const l = n.childForFieldName('left');
        const r = n.childForFieldName('right');
        if (l?.type === 'null_literal' || r?.type === 'null_literal') a.features.nullChecks++;
      }
      return;
    }
    case 'throw_statement': {
      if (namedNonComment(n)[0]?.type === 'object_creation_expression') a.features.throwsNew++;
      return;
    }
    case 'string_literal': {
      if (looksLikeSql(ctx.slice(n))) a.features.sqlStrings++;
      return;
    }
    case 'return_statement': {
      if (namedNonComment(n)[0]?.type === 'null_literal') a.features.returnsNull++;
      return;
    }
    default:
      return;
  }
}

/** Verilen düğümlerin tüm alt ağacını analiz eder (lambda ve anonim sınıf içleri dahil). */
function analyze(nodes: (Node | null | undefined)[], ctx: FileCtx, owner: OwnerInfo): Analysis {
  const a: Analysis = { callSites: [], localTypes: {}, complexity: 1, features: emptyFeatures() };
  for (const root of nodes) {
    if (!root) continue;
    for (const ev of ctx.eventsIn(root.startIndex, root.endIndex)) {
      if (ev.node) visitNode(ev.node, ctx, a, owner);
      else if (ev.type === 'synchronized_statement') a.features.synchronizedBlocks++;
      else a.complexity++;
    }
    for (const cm of ctx.comments(root.startIndex, root.endIndex)) {
      if (TODO_RE.test(cm.t)) a.features.todos++;
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// Bildirim okuma
// ---------------------------------------------------------------------------

interface ModInfo {
  modifiers: string[];
  annotations: string[];
}

function readModifiers(ctx: FileCtx, n: Node | null): ModInfo {
  const info: ModInfo = { modifiers: [], annotations: [] };
  if (!n) return info;
  for (const ch of n.children) {
    if (!ch || COMMENT_TYPES.has(ch.type)) continue;
    if (ch.type === 'marker_annotation' || ch.type === 'annotation') info.annotations.push(collapseWs(ctx.slice(ch)));
    else info.modifiers.push(ctx.slice(ch));
  }
  return info;
}

function explicitVisibility(mods: string[]): Visibility | undefined {
  if (mods.includes('public')) return 'public';
  if (mods.includes('protected')) return 'protected';
  if (mods.includes('private')) return 'private';
  return undefined;
}

function addMods(mods: string[], extra: string[]): string[] {
  const out = [...mods];
  for (const m of extra) if (!out.includes(m)) out.push(m);
  return out;
}

function readSpread(ctx: FileCtx, n: Node): { name: string; type: string } | undefined {
  let typeNode: Node | undefined;
  let name: string | undefined;
  for (const ch of namedNonComment(n)) {
    if (ch.type === 'modifiers') continue;
    if (ch.type === 'variable_declarator') {
      const nm = ch.childForFieldName('name');
      name = nm ? ctx.slice(nm) : ctx.slice(ch);
    } else if (!typeNode && ch.type !== 'marker_annotation' && ch.type !== 'annotation') typeNode = ch;
  }
  if (!typeNode || !name) return undefined;
  return { name, type: `${collapseWs(ctx.slice(typeNode))}...` };
}

function readParams(ctx: FileCtx, paramsNode: Node | null): JavaParam[] {
  const params: JavaParam[] = [];
  if (!paramsNode) return params;
  for (const p of namedNonComment(paramsNode)) {
    if (p.type === 'formal_parameter') {
      const t = p.childForFieldName('type');
      const nm = p.childForFieldName('name');
      const dims = p.childForFieldName('dimensions');
      if (!t) continue;
      params.push({
        name: nm ? ctx.slice(nm) : '',
        type: collapseWs(ctx.slice(t)) + (dims ? collapseWs(ctx.slice(dims)).replace(/\s+/g, '') : ''),
        varargs: false,
      });
    } else if (p.type === 'spread_parameter') {
      const s = readSpread(ctx, p);
      if (s) params.push({ name: s.name, type: s.type, varargs: true });
    }
  }
  return params;
}

function readThrows(ctx: FileCtx, n: Node): string[] {
  const t = childOfType(n, 'throws');
  if (!t) return [];
  return namedNonComment(t).map((x) => collapseWs(ctx.slice(x)));
}

function findJavadoc(ctx: FileCtx, n: Node): { text: string; range: Range } | undefined {
  const prev = n.previousSibling;
  if (prev && prev.type === 'block_comment') {
    const text = ctx.slice(prev);
    if (text.startsWith('/**') && text !== '/**/') return { text, range: rangeOf(prev) };
  }
  return undefined;
}

function buildSignature(parts: {
  modifiers: string[];
  typeParams?: string;
  returnType?: string;
  name: string;
  params?: JavaParam[];
  throws?: string[];
}): string {
  const out: string[] = [];
  if (parts.modifiers.length) out.push(parts.modifiers.join(' '));
  if (parts.typeParams) out.push(parts.typeParams);
  if (parts.returnType) out.push(parts.returnType);
  let head = parts.name;
  if (parts.params) head += `(${parts.params.map((p) => `${p.type}${p.name ? ` ${p.name}` : ''}`).join(', ')})`;
  out.push(head);
  if (parts.throws && parts.throws.length) out.push(`throws ${parts.throws.join(', ')}`);
  return out.join(' ');
}

function methodId(owner: string, name: string, params: JavaParam[]): string {
  return `${owner}#${name}(${params.map((p) => eraseTypeForId(p.type)).join(',')})`;
}

/**
 * Aynı tipte aynı id'yi alan metot/yapıcılar (`fmt(java.util.Date)` ↔ `fmt(java.sql.Date)`, `A.Builder` ↔ `B.Builder`
 * parametreleri) haritalarda birbirini ezmesin diye ayrıştırılır. Yalnız çakışan gruba dokunulur (çakışma yoksa id
 * biçimi değişmez): her üyenin parametreleri kaynakta yazıldığı nitelikle (`java.sql.Date`) yazılır; yine aynı kalanlara
 * kaynak sırasıyla `~2`, `~3` ... soneki eklenir (ilk üye soneksiz).
 */
function disambiguateMemberIds(type: JavaType): void {
  const groups = new Map<string, JavaMember[]>();
  for (const m of type.members) {
    if (m.kind !== 'method' && m.kind !== 'constructor') continue;
    const g = groups.get(m.id);
    if (g) g.push(m);
    else groups.set(m.id, [m]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const taken = new Set<string>();
    for (const m of group) {
      const qualified = `${m.ownerFqn}#${m.name}(${m.params.map((p) => qualifiedTypeForId(p.type)).join(',')})`;
      let id = qualified;
      for (let n = 2; taken.has(id); n++) id = `${qualified}~${n}`;
      taken.add(id);
      m.id = id;
    }
  }
}

/** Id için nitelikli parametre tipi: generic/annotation silinmiş, kaynakta yazıldığı nitelik ve `[]`/`...` korunur. */
function qualifiedTypeForId(text: string): string {
  return stripTypeArgs(text);
}

// ---------------------------------------------------------------------------
// Tip ve üye çıkarımı
// ---------------------------------------------------------------------------

interface TypeCtx {
  type: JavaType;
  owner: OwnerInfo;
  isInterfaceLike: boolean;
  clinit: number;
  init: number;
}

function baseMember(
  ctx: FileCtx,
  tc: TypeCtx,
  node: Node,
  init: {
    kind: MemberKind;
    name: string;
    id: string;
    params?: JavaParam[];
    mods: ModInfo;
    visibility: Visibility;
    signature: string;
    analysisNodes: (Node | null)[];
    bodyNode?: Node | null;
  },
): JavaMember {
  const a = analyze(init.analysisNodes, ctx, tc.owner);
  const jd = findJavadoc(ctx, node);
  const m: JavaMember = {
    kind: init.kind,
    name: init.name,
    id: init.id,
    ownerFqn: tc.type.fqn,
    params: init.params ?? [],
    throws: [],
    modifiers: init.mods.modifiers,
    annotations: init.mods.annotations,
    visibility: init.visibility,
    range: rangeOf(node),
    signature: init.signature,
    text: ctx.lineSlice(node),
    normalizedBody: init.bodyNode ? ctx.compact(init.bodyNode.startIndex, init.bodyNode.endIndex) : '',
    normalizedText: ctx.norm(node.startIndex, node.endIndex),
    callSites: a.callSites,
    localTypes: a.localTypes,
    complexity: a.complexity,
    features: a.features,
  };
  if (jd) {
    m.javadoc = jd.text;
    m.javadocRange = jd.range;
  }
  const anon = anonymousClassesIn(ctx, init.analysisNodes);
  if (anon.length) m.anonymousClasses = anon;
  return m;
}

/** Düğümlerdeki anonim sınıflar (kaynak sırasıyla, iç içe olanlar dahil) ve gövdelerindeki metotlar. */
function anonymousClassesIn(ctx: FileCtx, nodes: (Node | null | undefined)[]): AnonymousClassInfo[] {
  if (ctx.anonBodies().length === 0) return [];
  const out: AnonymousClassInfo[] = [];
  for (const root of nodes) {
    if (!root) continue;
    for (const ev of ctx.eventsIn(root.startIndex, root.endIndex)) {
      if (ev.type !== 'object_creation_expression' || !ev.node) continue;
      const body = childOfType(ev.node, 'class_body');
      const t = ev.node.childForFieldName('type');
      if (!body || !t) continue;
      const methods: AnonymousClassInfo['methods'] = [];
      for (const ch of namedNonComment(body)) {
        if (ch.type !== 'method_declaration') continue;
        const nm = ch.childForFieldName('name');
        if (!nm) continue;
        methods.push({
          name: ctx.slice(nm),
          params: readParams(ctx, ch.childForFieldName('parameters')),
          line: ch.startPosition.row + 1,
        });
      }
      out.push({ superType: stripTypeArgs(ctx.slice(t)), line: ev.node.startPosition.row + 1, methods });
    }
  }
  return out;
}

/** Bildirim ad tanımlayıcısının konumunu üye/tipe yazar ([s, e) kaynak indeksleri). */
function setDeclName(ctx: FileCtx, target: JavaMember | JavaType, s: number, e: number): void {
  const p = ctx.pos(s);
  target.nameLine = p.line;
  target.nameCol = p.col;
  target.nameEndCol = p.col + (e - s);
}

function setDeclNameNode(ctx: FileCtx, target: JavaMember | JavaType, n: Node | null | undefined): void {
  if (n) setDeclName(ctx, target, n.startIndex, n.endIndex);
}

function memberVisibility(tc: TypeCtx, mods: string[]): Visibility {
  return explicitVisibility(mods) ?? (tc.isInterfaceLike ? 'public' : 'package');
}

function extractMethod(ctx: FileCtx, tc: TypeCtx, n: Node): JavaMember {
  const nameNode = n.childForFieldName('name');
  const name = nameNode ? ctx.slice(nameNode) : '<hata>';
  const mods = readModifiers(ctx, childOfType(n, 'modifiers'));
  const explicitMods = [...mods.modifiers];
  const tpNode = n.childForFieldName('type_parameters');
  const typeParams = tpNode ? collapseWs(ctx.slice(tpNode)) : undefined;
  const typeNode = n.childForFieldName('type');
  const dimsNode = n.childForFieldName('dimensions');
  const returnType = typeNode
    ? collapseWs(ctx.slice(typeNode)) + (dimsNode ? collapseWs(ctx.slice(dimsNode)).replace(/\s+/g, '') : '')
    : undefined;
  const isAnnotationElement = n.type === 'annotation_type_element_declaration';
  const params = isAnnotationElement ? [] : readParams(ctx, n.childForFieldName('parameters'));
  const throwsList = readThrows(ctx, n);
  const body = isAnnotationElement ? n.childForFieldName('value') : n.childForFieldName('body');
  if (tc.isInterfaceLike) {
    const extra: string[] = [];
    if (!mods.modifiers.includes('private')) extra.push('public');
    const hasBody = !isAnnotationElement && !!body;
    if (isAnnotationElement || (!hasBody && !mods.modifiers.includes('static') && !mods.modifiers.includes('default'))) {
      extra.push('abstract');
    }
    mods.modifiers = addMods(mods.modifiers, extra);
  }
  const sigParts: Parameters<typeof buildSignature>[0] = { modifiers: explicitMods, name, params, throws: throwsList };
  if (typeParams) sigParts.typeParams = typeParams;
  if (returnType) sigParts.returnType = returnType;
  const m = baseMember(ctx, tc, n, {
    kind: 'method',
    name,
    id: methodId(tc.type.fqn, name, params),
    params,
    mods,
    visibility: memberVisibility(tc, mods.modifiers),
    signature: buildSignature(sigParts),
    analysisNodes: [childOfType(n, 'modifiers'), n.childForFieldName('parameters'), body],
    bodyNode: body,
  });
  m.throws = throwsList;
  if (returnType) m.returnType = returnType;
  if (typeParams) m.typeParams = typeParams;
  setDeclNameNode(ctx, m, nameNode);
  return m;
}

function extractConstructor(ctx: FileCtx, tc: TypeCtx, n: Node, recordParams: JavaParam[]): JavaMember {
  const compact = n.type === 'compact_constructor_declaration';
  const nameNode = n.childForFieldName('name');
  const name = nameNode ? ctx.slice(nameNode) : tc.type.name;
  const mods = readModifiers(ctx, childOfType(n, 'modifiers'));
  const explicitMods = [...mods.modifiers];
  const tpNode = n.childForFieldName('type_parameters');
  const typeParams = tpNode ? collapseWs(ctx.slice(tpNode)) : undefined;
  const params = compact ? recordParams.map((p) => ({ ...p })) : readParams(ctx, n.childForFieldName('parameters'));
  const throwsList = readThrows(ctx, n);
  const body = n.childForFieldName('body');
  let visibility = explicitVisibility(mods.modifiers);
  if (!visibility) visibility = tc.type.kind === 'enum' ? 'private' : 'package';
  const sigParts: Parameters<typeof buildSignature>[0] = { modifiers: explicitMods, name, params, throws: throwsList };
  if (typeParams) sigParts.typeParams = typeParams;
  const m = baseMember(ctx, tc, n, {
    kind: 'constructor',
    name,
    id: methodId(tc.type.fqn, name, params),
    params,
    mods,
    visibility,
    signature: compact ? buildSignature({ modifiers: explicitMods, name }) : buildSignature(sigParts),
    analysisNodes: [childOfType(n, 'modifiers'), compact ? null : n.childForFieldName('parameters'), body],
    bodyNode: body,
  });
  m.throws = throwsList;
  if (typeParams) m.typeParams = typeParams;
  if (compact) {
    for (const p of params) if (!(p.name in m.localTypes)) m.localTypes[p.name] = p.type;
  }
  setDeclNameNode(ctx, m, nameNode);
  return m;
}

function extractFields(ctx: FileCtx, tc: TypeCtx, n: Node): JavaMember[] {
  const modsNode = childOfType(n, 'modifiers');
  const typeNode = n.childForFieldName('type');
  const typeText = typeNode ? collapseWs(ctx.slice(typeNode)) : '?';
  const declarators = n.childrenForFieldName('declarator').filter((d): d is Node => !!d);
  const out: JavaMember[] = [];
  const single = declarators.length === 1;
  for (const d of declarators) {
    const mods = readModifiers(ctx, modsNode);
    const explicitMods = [...mods.modifiers];
    if (tc.isInterfaceLike) mods.modifiers = addMods(mods.modifiers, ['public', 'static', 'final']);
    const nm = d.childForFieldName('name');
    const name = nm ? ctx.slice(nm) : '<hata>';
    const dims = d.childForFieldName('dimensions');
    const fieldType = typeText + (dims ? ctx.slice(dims).replace(/\s+/g, '') : '');
    const value = d.childForFieldName('value');
    const m = baseMember(ctx, tc, n, {
      kind: 'field',
      name,
      id: `${tc.type.fqn}#${name}`,
      mods,
      visibility: memberVisibility(tc, mods.modifiers),
      signature: buildSignature({ modifiers: explicitMods, returnType: fieldType, name }),
      analysisNodes: single ? [modsNode, value] : [value],
      bodyNode: value,
    });
    m.fieldType = fieldType;
    setDeclNameNode(ctx, m, nm);
    if (value) m.initializerText = ctx.slice(value);
    if (!single) {
      // Çoklu bildirici: her alan için yalnız kendi bildiricisini içeren sentetik metin
      const prefixEnd = typeNode ? typeNode.endIndex : n.startIndex;
      const prefixRaw = ctx.indentBefore(n.startIndex) + ctx.src.slice(n.startIndex, prefixEnd);
      m.text = `${prefixRaw} ${ctx.slice(d)};`;
      m.normalizedText = `${ctx.norm(n.startIndex, prefixEnd)} ${ctx.norm(d.startIndex, d.endIndex)} ;`;
    }
    out.push(m);
  }
  return out;
}

function extractEnumConstant(ctx: FileCtx, tc: TypeCtx, n: Node): JavaMember {
  const nm = n.childForFieldName('name');
  const name = nm ? ctx.slice(nm) : '<hata>';
  const mods = readModifiers(ctx, childOfType(n, 'modifiers'));
  mods.modifiers = addMods(mods.modifiers, ['public', 'static', 'final']);
  const args = n.childForFieldName('arguments');
  const body = n.childForFieldName('body');
  const m = baseMember(ctx, tc, n, {
    kind: 'enumConstant',
    name,
    id: `${tc.type.fqn}#${name}`,
    mods,
    visibility: 'public',
    signature: name,
    analysisNodes: [args, body],
  });
  const start = args ?? body;
  const end = body ?? args;
  m.normalizedBody = start && end ? ctx.compact(start.startIndex, end.endIndex) : '';
  m.fieldType = tc.type.name;
  setDeclNameNode(ctx, m, nm);
  return m;
}

function extractInitializer(ctx: FileCtx, tc: TypeCtx, n: Node, isStatic: boolean): JavaMember {
  const seq = isStatic ? tc.clinit++ : tc.init++;
  const name = isStatic ? '<clinit>' : '<init>';
  const block = isStatic ? childOfType(n, 'block') : n;
  const m = baseMember(ctx, tc, n, {
    kind: 'initializer',
    name,
    id: `${tc.type.fqn}#${name}#${seq}`,
    mods: { modifiers: isStatic ? ['static'] : [], annotations: [] },
    visibility: 'private',
    signature: isStatic ? 'static { }' : '{ }',
    analysisNodes: [block],
    bodyNode: block,
  });
  // adsız: `static` ya da `{` belirteci
  setDeclName(ctx, m, n.startIndex, n.startIndex + (isStatic ? 'static'.length : 1));
  return m;
}

function extractRecordComponents(ctx: FileCtx, tc: TypeCtx, paramsNode: Node | null): { params: JavaParam[]; members: JavaMember[] } {
  const params = readParams(ctx, paramsNode);
  const members: JavaMember[] = [];
  if (!paramsNode) return { params, members };
  const nodes = namedNonComment(paramsNode).filter((p) => p.type === 'formal_parameter' || p.type === 'spread_parameter');
  nodes.forEach((pn, i) => {
    const p = params[i];
    if (!p) return;
    const mods = readModifiers(ctx, childOfType(pn, 'modifiers'));
    mods.modifiers = addMods(mods.modifiers, ['private', 'final']);
    const m = baseMember(ctx, tc, pn, {
      kind: 'field',
      name: p.name,
      id: `${tc.type.fqn}#${p.name}`,
      mods,
      visibility: 'private',
      signature: `${p.type} ${p.name}`,
      analysisNodes: [],
    });
    delete m.javadoc;
    delete m.javadocRange;
    m.fieldType = p.type;
    const nameNode =
      pn.childForFieldName('name') ?? namedNonComment(pn).find((x) => x.type === 'variable_declarator')?.childForFieldName('name');
    setDeclNameNode(ctx, m, nameNode);
    members.push(m);
  });
  return { params, members };
}

function readSuperTypes(ctx: FileCtx, n: Node): { superclass?: string; interfaces: string[] } {
  const res: { superclass?: string; interfaces: string[] } = { interfaces: [] };
  const sc = n.childForFieldName('superclass');
  if (sc) {
    const t = namedNonComment(sc)[0];
    if (t) res.superclass = stripTypeArgs(ctx.slice(t));
  }
  const ifaceNode = n.childForFieldName('interfaces') ?? childOfType(n, 'extends_interfaces');
  if (ifaceNode) {
    const list = childOfType(ifaceNode, 'type_list');
    const items = list ? namedNonComment(list) : namedNonComment(ifaceNode);
    for (const t of items) res.interfaces.push(stripTypeArgs(ctx.slice(t)));
  }
  return res;
}

function extractType(
  ctx: FileCtx,
  n: Node,
  pkg: string,
  outer: JavaType | undefined,
  out: JavaType[],
): void {
  const kind = TYPE_KINDS[n.type];
  if (!kind) return;
  const nameNode = n.childForFieldName('name');
  const name = nameNode ? ctx.slice(nameNode) : '<hata>';
  const fqn = outer ? `${outer.fqn}.${name}` : pkg ? `${pkg}.${name}` : name;
  const mods = readModifiers(ctx, childOfType(n, 'modifiers'));
  const outerIsInterfaceLike = !!outer && (outer.kind === 'interface' || outer.kind === 'annotation');
  if (outerIsInterfaceLike) mods.modifiers = addMods(mods.modifiers, ['public', 'static']);
  const visibility = explicitVisibility(mods.modifiers) ?? (outerIsInterfaceLike ? 'public' : 'package');
  const tpNode = n.childForFieldName('type_parameters');
  const supers = readSuperTypes(ctx, n);
  const jd = findJavadoc(ctx, n);
  const type: JavaType = {
    fqn,
    name,
    kind,
    modifiers: mods.modifiers,
    annotations: mods.annotations,
    visibility,
    interfaces: supers.interfaces,
    range: rangeOf(n),
    members: [],
    nestedTypeFqns: [],
    fieldTypes: {},
    normalizedText: ctx.norm(n.startIndex, n.endIndex),
  };
  if (tpNode) type.typeParams = collapseWs(ctx.slice(tpNode));
  if (supers.superclass) type.superclass = supers.superclass;
  if (jd) type.javadoc = jd.text;
  setDeclNameNode(ctx, type, nameNode);
  if (outer) {
    type.outerFqn = outer.fqn;
    outer.nestedTypeFqns.push(fqn);
  }
  out.push(type);

  const tc: TypeCtx = {
    type,
    owner: supers.superclass ? { simpleName: name, superSimpleName: simpleName(supers.superclass) } : { simpleName: name },
    isInterfaceLike: kind === 'interface' || kind === 'annotation',
    clinit: 0,
    init: 0,
  };

  let recordParams: JavaParam[] = [];
  if (kind === 'record') {
    const rc = extractRecordComponents(ctx, tc, n.childForFieldName('parameters'));
    recordParams = rc.params;
    type.members.push(...rc.members);
  }

  const body = n.childForFieldName('body');
  if (!body) return;
  const handle = (ch: Node): void => {
    try {
      switch (ch.type) {
        case 'method_declaration':
        case 'annotation_type_element_declaration':
          type.members.push(extractMethod(ctx, tc, ch));
          break;
        case 'constructor_declaration':
        case 'compact_constructor_declaration':
          type.members.push(extractConstructor(ctx, tc, ch, recordParams));
          break;
        case 'field_declaration':
        case 'constant_declaration':
          type.members.push(...extractFields(ctx, tc, ch));
          break;
        case 'enum_constant':
          type.members.push(extractEnumConstant(ctx, tc, ch));
          break;
        case 'static_initializer':
          type.members.push(extractInitializer(ctx, tc, ch, true));
          break;
        case 'block':
          type.members.push(extractInitializer(ctx, tc, ch, false));
          break;
        case 'enum_body_declarations':
          for (const x of namedNonComment(ch)) handle(x);
          break;
        case 'ERROR':
          for (const x of namedNonComment(ch)) handle(x);
          break;
        default:
          if (TYPE_KINDS[ch.type]) extractType(ctx, ch, pkg, type, out);
      }
    } catch {
      // Hatalı/eksik düğüm: bu bildirimi atla, dosyanın geri kalanını çıkarmaya devam et
    }
  };
  for (const ch of namedNonComment(body)) handle(ch);
  disambiguateMemberIds(type);

  for (const m of type.members) {
    if ((m.kind === 'field' || m.kind === 'enumConstant') && m.fieldType) type.fieldTypes[m.name] = m.fieldType;
  }
}

function readImport(ctx: FileCtx, n: Node): JavaImport {
  let isStatic = false;
  let wildcard = false;
  let name = '';
  for (const ch of n.children) {
    if (!ch) continue;
    if (ch.type === 'static') isStatic = true;
    else if (ch.type === 'asterisk') wildcard = true;
    else if (ch.type === 'scoped_identifier' || ch.type === 'identifier') name = ctx.slice(ch).replace(/\s+/g, '');
  }
  return { name, static: isStatic, wildcard, line: n.startPosition.row + 1 };
}

function collectErrorLines(root: Node): number[] {
  const lines = new Set<number>();
  const visit = (n: Node): void => {
    if (n.isError || n.isMissing) lines.add(n.startPosition.row + 1);
    if (!n.hasError && !n.isMissing) return;
    for (const ch of n.children) {
      if (ch && (ch.hasError || ch.isMissing || ch.isError)) visit(ch);
    }
  };
  visit(root);
  return [...lines].sort((a, b) => a - b);
}

function countLines(src: string): number {
  if (src.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return src.endsWith('\n') ? n - 1 : n;
}

/** Java kaynağını sembol modeline çevirir. Sözdizimi hatalı dosyalarda da çökmez; hasErrors/errorLines doldurulur. */
export async function parseJavaFile(path: string, source: string): Promise<JavaFileModel> {
  const parser = await getJavaParser();
  const model: JavaFileModel = {
    path,
    packageName: '',
    imports: [],
    types: [],
    hasErrors: false,
    errorLines: [],
    lineCount: countLines(source),
    normalizedCode: '',
  };
  // tree-sitter-java'nın desteklemediği varargs tip anotasyonları aynı uzunlukta boşlukla maskelenir (her zaman,
  // içerik deterministik). Ham metinler (text, imza, parametre) orijinal kaynaktan dilimlenir; maskelenen tokenlar
  // normalizasyona geri eklenir.
  const masked = maskVarargsAnnotations(source);
  const tree = parser.parse(masked ? masked.source : source);
  if (!tree) {
    model.hasErrors = true;
    return model;
  }
  try {
    const root = tree.rootNode;
    const ctx = new FileCtx(source);
    ctx.collect(root);
    if (masked) ctx.addTokens(maskedTokens(source, masked.spans));
    model.typeRefs = ctx.typeRefs();
    model.typeRefPositions = ctx.typeRefTable();
    const codeParts: string[] = [];
    for (const ch of namedNonComment(root)) {
      if (ch.type === 'package_declaration') {
        const id = namedNonComment(ch).find((x) => x.type === 'scoped_identifier' || x.type === 'identifier');
        if (id) model.packageName = ctx.slice(id).replace(/\s+/g, '');
      }
    }
    const topLevel = (ch: Node, collectCode: boolean): void => {
      try {
        if (ch.type === 'import_declaration') {
          model.imports.push(readImport(ctx, ch));
          return;
        }
        if (collectCode) {
          const part = ctx.norm(ch.startIndex, ch.endIndex);
          if (part) codeParts.push(part);
        }
        if (TYPE_KINDS[ch.type]) extractType(ctx, ch, model.packageName, undefined, model.types);
        else if (ch.type === 'ERROR') for (const x of namedNonComment(ch)) topLevel(x, false);
      } catch {
        // tek bir üst düzey bildirimdeki beklenmeyen yapı tüm dosyayı düşürmesin
      }
    };
    for (const ch of namedNonComment(root)) topLevel(ch, true);
    model.normalizedCode = codeParts.join(' ');
    if (root.hasError) {
      model.hasErrors = true;
      model.errorLines = collectErrorLines(root);
      if (model.errorLines.length === 0) model.errorLines = [1];
    }
  } finally {
    tree.delete();
  }
  return model;
}

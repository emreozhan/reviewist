/**
 * Java kaynağını sembol modeline (JavaFileModel) çevirir.
 * Tüm normalizasyonlar tree-sitter yaprak düğümlerinden üretilir; string literal içerikleri korunur.
 */
import type { Node } from 'web-tree-sitter';
import type { MemberKind, Range, TypeKind } from '../../shared/types.js';
import type {
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
import { baseTypeName, collapseWs, eraseTypeForId, simpleName, stripTypeArgs } from './names.js';
import { getJavaParser } from './parser.js';

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

  constructor(readonly src: string) {}

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
    return this.tokens(s, e).join(' ');
  }

  /** Yorumsuz, tüm boşluklar atılmış metin (string içerikleri korunur). */
  compact(s: number, e: number): string {
    return this.tokens(s, e).join('');
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
  for (let i = 0; i < n.childCount; i++) {
    const ch = n.child(i);
    if (ch && ch.type === type) return ch;
  }
  return null;
}

function namedNonComment(n: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < n.namedChildCount; i++) {
    const ch = n.namedChild(i);
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

const SQL_RE = /\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b/i;
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
      const objText = obj ? collapseWs(ctx.slice(obj)).replace(/\s*\.\s*/g, '.') : undefined;
      if (objText !== undefined) site.receiver = objText;
      a.callSites.push(site);
      if (name === 'printStackTrace') a.features.printStackTrace++;
      if (objText === 'System.out' || objText === 'System.err') a.features.systemOut++;
      if (
        name === 'requireNonNull' &&
        (objText === undefined || objText === 'Objects' || objText === 'java.util.Objects')
      ) {
        a.features.nullChecks++;
      }
      if (objText === 'Optional' || objText === 'java.util.Optional') a.features.nullChecks++;
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
      a.callSites.push(site);
      return;
    }
    case 'method_reference': {
      const kids = namedNonComment(n);
      const recv = kids[0] ?? null;
      let isCtor = false;
      for (let i = 0; i < n.childCount; i++) if (n.child(i)?.type === 'new') isCtor = true;
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
      a.callSites.push(site);
      if (recvText === 'System.out' || recvText === 'System.err') a.features.systemOut++;
      return;
    }
    case 'explicit_constructor_invocation': {
      const ctor = n.childForFieldName('constructor');
      const isSuper = ctor?.type === 'super';
      const args = n.childForFieldName('arguments');
      a.callSites.push({
        name: isSuper ? (owner.superSimpleName ?? 'super') : owner.simpleName,
        argCount: argCountOf(args),
        receiverKind: isSuper ? 'super' : 'this',
        receiver: isSuper ? 'super' : 'this',
        line: n.startPosition.row + 1,
        isConstructor: true,
        isMethodRef: false,
        args: argTextsOf(ctx, args),
      });
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
      if (SQL_RE.test(ctx.slice(n))) a.features.sqlStrings++;
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
  for (let i = 0; i < n.childCount; i++) {
    const ch = n.child(i);
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
  return m;
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
  return m;
}

function extractInitializer(ctx: FileCtx, tc: TypeCtx, n: Node, isStatic: boolean): JavaMember {
  const seq = isStatic ? tc.clinit++ : tc.init++;
  const name = isStatic ? '<clinit>' : '<init>';
  const block = isStatic ? childOfType(n, 'block') : n;
  return baseMember(ctx, tc, n, {
    kind: 'initializer',
    name,
    id: `${tc.type.fqn}#${name}#${seq}`,
    mods: { modifiers: isStatic ? ['static'] : [], annotations: [] },
    visibility: 'private',
    signature: isStatic ? 'static { }' : '{ }',
    analysisNodes: [block],
    bodyNode: block,
  });
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

  for (const m of type.members) {
    if ((m.kind === 'field' || m.kind === 'enumConstant') && m.fieldType) type.fieldTypes[m.name] = m.fieldType;
  }
}

function readImport(ctx: FileCtx, n: Node): JavaImport {
  let isStatic = false;
  let wildcard = false;
  let name = '';
  for (let i = 0; i < n.childCount; i++) {
    const ch = n.child(i);
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
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i);
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
  const tree = parser.parse(source);
  if (!tree) {
    model.hasErrors = true;
    return model;
  }
  try {
    const root = tree.rootNode;
    const ctx = new FileCtx(source);
    ctx.collect(root);
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

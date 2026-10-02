/**
 * İki Java dosya modeli arasındaki semantik (sembol düzeyi) fark.
 */
import { diffLines } from 'diff';
import type { ChangeFlag, ChangeStatus, MemberChange, RiskInfo, TypeChange } from '../../shared/types.js';
import type { JavaFileModel, JavaMember, JavaType, MemberDiff, TypeDiff } from './model.js';
import {
  eraseTypeForId,
  isTestPath,
  normalizeVarargs,
  renameTypeVars,
  simpleName,
  typeParamNames,
  typeVarMap,
} from './names.js';

export interface DiffFileOptions {
  oldPath?: string;
  newPath?: string;
  /**
   * (Tur 3, B7) Dosya git'te yeniden adlandırıldı/taşındı (R%). true ise ve her iki tarafta tek üst düzey tip varsa
   * tipler benzerlik eşiğinden bağımsız eşlenir (`renamed`/`moved`); iç tipleri de dış tipe göre göreli adla eşlenir.
   */
  fileRenamed?: boolean;
}

const RENAME_THRESHOLD = 0.85;
const TYPE_MATCH_THRESHOLD = 0.6;
const TRIVIAL_TOKENS = 4;
/** B6: farklı ad / tipler arası eşleşmede gövde en az bu kadar token olmalı (ya da imza şekli aynı olmalı). */
const MIN_MOVE_TOKENS = 15;
const VISIBILITY_MODS = new Set(['public', 'protected', 'private']);

function emptyRisk(): RiskInfo {
  return { score: 0, level: 'low', reasons: [] };
}

// ---------------------------------------------------------------------------
// Benzerlik
// ---------------------------------------------------------------------------

interface Bag {
  counts: Map<string, number>;
  size: number;
  tokenCount: number;
}

const bagCache = new WeakMap<JavaMember, Bag>();

const NORM_TOKEN_RE = /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g;
const RAW_TOKEN_RE = /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|\d[\w.]*|\S/g;

/** normalizedBody'nin token dizisi: normalizedText'in sonekinden (boşluklar korunmuş tokenlar) çıkarılır. */
function bodyTokens(m: JavaMember): string[] {
  const target = m.normalizedBody;
  if (!target) return [];
  const toks = m.normalizedText.match(NORM_TOKEN_RE) ?? [];
  let end = toks.length;
  if (end > 0 && toks[end - 1] === ';' && !target.endsWith(';')) end--;
  let acc = 0;
  for (let i = end - 1; i >= 0; i--) {
    acc += (toks[i] as string).length;
    if (acc === target.length) {
      const slice = toks.slice(i, end);
      if (slice.join('') === target) return slice;
      break;
    }
    if (acc > target.length) break;
  }
  return target.match(RAW_TOKEN_RE) ?? [];
}

function signatureTokens(m: JavaMember): string[] {
  const toks: string[] = [m.kind];
  if (m.returnType) toks.push(m.returnType.replace(/\s+/g, ''));
  if (m.fieldType) toks.push(m.fieldType.replace(/\s+/g, ''));
  for (const p of m.params) toks.push(eraseTypeForId(p.type));
  for (const t of m.throws) toks.push(t);
  return toks;
}

function makeBag(tokens: string[]): Bag {
  const counts = new Map<string, number>();
  const add = (k: string): void => {
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  if (tokens.length === 1) add(tokens[0] as string);
  for (let i = 0; i + 1 < tokens.length; i++) add(`${tokens[i] as string}\u0001${tokens[i + 1] as string}`);
  let size = 0;
  for (const v of counts.values()) size += v;
  return { counts, size, tokenCount: tokens.length };
}

function bagOf(m: JavaMember): Bag {
  let b = bagCache.get(m);
  if (!b) {
    b = makeBag(bodyTokens(m));
    bagCache.set(m, b);
  }
  return b;
}

function dice(a: Bag, b: Bag): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.counts.size <= b.counts.size ? [a, b] : [b, a];
  let inter = 0;
  for (const [k, v] of small.counts) {
    const w = large.counts.get(k);
    if (w) inter += Math.min(v, w);
  }
  return (2 * inter) / (a.size + b.size);
}

function upperBound(a: Bag, b: Bag): number {
  if (a.size === 0 && b.size === 0) return 1;
  return (2 * Math.min(a.size, b.size)) / (a.size + b.size);
}

/**
 * İki üyenin benzerliği (0..1): normalizedBody token bigramları üzerinde Dice katsayısı.
 * İkisi de gövdesizse imza (tür, dönüş/alan tipi, parametre tipleri, throws) benzerliği.
 */
export function memberSimilarity(a: JavaMember, b: JavaMember): number {
  const ba = bagOf(a);
  const bb = bagOf(b);
  if (ba.size === 0 && bb.size === 0) {
    if (a.normalizedBody === b.normalizedBody && a.normalizedBody !== '') return 1;
    return dice(makeBag(signatureTokens(a)), makeBag(signatureTokens(b)));
  }
  return dice(ba, bb);
}

function isTrivial(m: JavaMember): boolean {
  return bagOf(m).tokenCount < TRIVIAL_TOKENS;
}

/** Aynı tür, aynı (silinmiş) parametre tipleri ve aynı dönüş/alan tipi. */
function sameShape(a: JavaMember, b: JavaMember): boolean {
  if (a.kind !== b.kind || a.params.length !== b.params.length) return false;
  for (let i = 0; i < a.params.length; i++) {
    const pa = normalizeVarargs(eraseTypeForId((a.params[i] as { type: string }).type));
    const pb = normalizeVarargs(eraseTypeForId((b.params[i] as { type: string }).type));
    if (pa !== pb) return false;
  }
  const ra = a.returnType ? eraseTypeForId(a.returnType) : '';
  const rb = b.returnType ? eraseTypeForId(b.returnType) : '';
  const fa = a.fieldType ? eraseTypeForId(a.fieldType) : '';
  const fb = b.fieldType ? eraseTypeForId(b.fieldType) : '';
  return ra === rb && fa === fb;
}

/**
 * B6: farklı ad veya farklı tip arasında eşleşme için gövde yeterince ayırt edici mi:
 * her iki gövde en az MIN_MOVE_TOKENS token ya da imza şekli (parametre + dönüş tipi) aynı.
 */
function significantPair(a: JavaMember, b: JavaMember): boolean {
  return (bagOf(a).tokenCount >= MIN_MOVE_TOKENS && bagOf(b).tokenCount >= MIN_MOVE_TOKENS) || sameShape(a, b);
}

interface Candidate<A, B> {
  a: A;
  b: B;
  score: number;
}

/** Skora göre azalan açgözlü eşleme; her öğe en fazla bir kez. */
function greedyPairs<A, B>(cands: Candidate<A, B>[]): Candidate<A, B>[] {
  cands.sort((x, y) => y.score - x.score);
  const usedA = new Set<A>();
  const usedB = new Set<B>();
  const out: Candidate<A, B>[] = [];
  for (const c of cands) {
    if (usedA.has(c.a) || usedB.has(c.b)) continue;
    usedA.add(c.a);
    usedB.add(c.b);
    out.push(c);
  }
  return out;
}

/** Gövde benzerliği eşik üstü adaylar; önemsiz (çok kısa) gövdelerde yalnız tekil eşleşme kabul edilir. */
function similarityCandidates(olds: JavaMember[], news: JavaMember[], threshold: number): Candidate<JavaMember, JavaMember>[] {
  const cands: Candidate<JavaMember, JavaMember>[] = [];
  for (const o of olds) {
    const bo = bagOf(o);
    for (const n of news) {
      if (o.kind !== n.kind) continue;
      const bn = bagOf(n);
      if (upperBound(bo, bn) < threshold) continue;
      const s = memberSimilarity(o, n);
      if (s >= threshold && significantPair(o, n)) cands.push({ a: o, b: n, score: s });
    }
  }
  const countA = new Map<JavaMember, number>();
  const countB = new Map<JavaMember, number>();
  for (const c of cands) {
    countA.set(c.a, (countA.get(c.a) ?? 0) + 1);
    countB.set(c.b, (countB.get(c.b) ?? 0) + 1);
  }
  return cands.filter(
    (c) => !(isTrivial(c.a) || isTrivial(c.b)) || (countA.get(c.a) === 1 && countB.get(c.b) === 1),
  );
}

// ---------------------------------------------------------------------------
// Satır sayıları
// ---------------------------------------------------------------------------

function fullText(m: JavaMember): string {
  return m.javadoc ? `${m.javadoc}\n${m.text}` : m.text;
}

function lineCountOf(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

function lineDelta(oldText: string, newText: string): { added: number; removed: number } {
  if (oldText === newText) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const part of diffLines(oldText, newText)) {
    const n = part.count ?? lineCountOf(part.value.replace(/\n$/, ''));
    if (part.added) added += n;
    else if (part.removed) removed += n;
  }
  return { added, removed };
}

// ---------------------------------------------------------------------------
// Üye karşılaştırma
// ---------------------------------------------------------------------------

/** B9: sınıf tip değişkenleri (dış tipler dahil, dıştan içe) iki tarafta. */
interface TvCtx {
  oldVars: string[];
  newVars: string[];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Üye çifti için tip değişkeni normalizasyonu: adlar farklıysa pozisyonel yer tutucuya çeviren fonksiyonlar. */
interface TvNorm {
  active: boolean;
  o: (t: string) => string;
  n: (t: string) => string;
}

const IDENTITY_TV: TvNorm = { active: false, o: (t) => t, n: (t) => t };

function tvNormFor(o: JavaMember, n: JavaMember, tv: TvCtx | undefined): TvNorm {
  const om = typeParamNames(o.typeParams);
  const nm = typeParamNames(n.typeParams);
  const oc = tv?.oldVars ?? [];
  const nc = tv?.newVars ?? [];
  if (sameList(om, nm) && sameList(oc, nc)) return IDENTITY_TV;
  const oMap = typeVarMap(oc, om);
  const nMap = typeVarMap(nc, nm);
  return { active: true, o: (t) => renameTypeVars(t, oMap), n: (t) => renameTypeVars(t, nMap) };
}

interface Comparison {
  /** B9: yalnız tip değişkeni adları farklı (normalize edilince eşit) bir alan var. */
  tvRenamed: boolean;
  sigFlags: ChangeFlag[];
  flags: ChangeFlag[];
  details: string[];
  bodyChanged: boolean;
  textChanged: boolean;
  normalizedChanged: boolean;
  javadocChanged: boolean;
}

function annotationName(a: string): string {
  const m = /^@\s*([\w$.]+)/.exec(a);
  return m ? `@${m[1] as string}` : a;
}

function noWs(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, '');
}

function compareAnnotations(oldA: string[], newA: string[], details: string[]): boolean {
  const oldMap = new Map(oldA.map((a) => [annotationName(a), a]));
  const newMap = new Map(newA.map((a) => [annotationName(a), a]));
  let changed = false;
  for (const [name, text] of newMap) {
    const prev = oldMap.get(name);
    if (prev === undefined) {
      details.push(`${name} eklendi`);
      changed = true;
    } else if (noWs(prev) !== noWs(text)) {
      details.push(`${name} değişti: ${prev} → ${text}`);
      changed = true;
    }
  }
  for (const name of oldMap.keys()) {
    if (!newMap.has(name)) {
      details.push(`${name} kaldırıldı`);
      changed = true;
    }
  }
  return changed;
}

function compareModifiers(oldM: string[], newM: string[], details: string[]): boolean {
  const o = new Set(oldM.filter((m) => !VISIBILITY_MODS.has(m)));
  const n = new Set(newM.filter((m) => !VISIBILITY_MODS.has(m)));
  let changed = false;
  for (const m of n) {
    if (!o.has(m)) {
      details.push(`${m} oldu`);
      changed = true;
    }
  }
  for (const m of o) {
    if (!n.has(m)) {
      details.push(`${m} olmaktan çıktı`);
      changed = true;
    }
  }
  return changed;
}

function compareParams(o: JavaMember, n: JavaMember, details: string[], tv: TvNorm = IDENTITY_TV): boolean {
  const oTypes = o.params.map((p) => noWs(tv.o(p.type)));
  const nTypes = n.params.map((p) => noWs(tv.n(p.type)));
  const typeEq = (op: { type: string }, np: { type: string }): boolean => noWs(tv.o(op.type)) === noWs(tv.n(np.type));
  const typesChanged = oTypes.length !== nTypes.length || oTypes.some((t, i) => t !== nTypes[i]);
  const oldByName = new Map(o.params.map((p) => [p.name, p]));
  const newByName = new Map(n.params.map((p) => [p.name, p]));
  const added = n.params.filter((p) => !oldByName.has(p.name));
  const removed = o.params.filter((p) => !newByName.has(p.name));
  const local: string[] = [];
  if (added.length === removed.length && o.params.length === n.params.length && added.length > 0) {
    // Konumsal eşleme (yeniden adlandırılmış parametreler)
    o.params.forEach((op, i) => {
      const np = n.params[i];
      if (!np) return;
      if (op.name !== np.name && !typeEq(op, np)) {
        local.push(`parametre: ${op.type} ${op.name} → ${np.type} ${np.name}`);
      } else if (op.name !== np.name) {
        local.push(`parametre adı: ${op.name} → ${np.name}`);
      } else if (!typeEq(op, np)) {
        local.push(`parametre tipi: ${op.type} → ${np.type} (${np.name})`);
      }
    });
  } else {
    for (const p of added) local.push(`parametre eklendi: ${p.type} ${p.name}`);
    for (const p of removed) local.push(`parametre kaldırıldı: ${p.type} ${p.name}`);
    for (const np of n.params) {
      const op = oldByName.get(np.name);
      if (op && !typeEq(op, np)) local.push(`parametre tipi: ${op.type} → ${np.type} (${np.name})`);
    }
    const commonOld = o.params.filter((p) => newByName.has(p.name)).map((p) => p.name);
    const commonNew = n.params.filter((p) => oldByName.has(p.name)).map((p) => p.name);
    if (commonOld.join(',') !== commonNew.join(',')) local.push('parametre sırası değişti');
  }
  details.push(...local);
  return typesChanged;
}

function compareThrows(oldT: string[], newT: string[], details: string[], tv: TvNorm = IDENTITY_TV): boolean {
  const o = new Set(oldT.map((t) => noWs(tv.o(t))));
  const n = new Set(newT.map((t) => noWs(tv.n(t))));
  let changed = false;
  for (const t of newT) {
    if (!o.has(noWs(tv.n(t)))) {
      details.push(`throws eklendi: ${t}`);
      changed = true;
    }
  }
  for (const t of oldT) {
    if (!n.has(noWs(tv.o(t)))) {
      details.push(`throws kaldırıldı: ${t}`);
      changed = true;
    }
  }
  return changed;
}

function shortText(s: string | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 37)}...` : t;
}

function compareMembers(
  o: JavaMember,
  n: JavaMember,
  delta: { added: number; removed: number },
  tvCtx?: TvCtx,
): Comparison {
  const details: string[] = [];
  const sigFlags: ChangeFlag[] = [];
  const tv = tvNormFor(o, n, tvCtx);
  const tvo = (t: string | undefined): string => noWs(t === undefined ? undefined : tv.o(t));
  const tvn = (t: string | undefined): string => noWs(t === undefined ? undefined : tv.n(t));
  if (o.name !== n.name && o.kind !== 'constructor') details.push(`ad değişti: ${o.name} → ${n.name}`);
  if (o.visibility !== n.visibility) {
    sigFlags.push('visibility');
    details.push(`görünürlük: ${o.visibility} → ${n.visibility}`);
  }
  if (compareModifiers(o.modifiers, n.modifiers, details)) sigFlags.push('modifiers');
  if (compareAnnotations(o.annotations, n.annotations, details)) sigFlags.push('annotations');
  if (compareParams(o, n, details, tv)) sigFlags.push('params');
  if (tvo(o.returnType) !== tvn(n.returnType)) {
    sigFlags.push('returnType');
    details.push(`dönüş tipi: ${o.returnType ?? '-'} → ${n.returnType ?? '-'}`);
  }
  if (compareThrows(o.throws, n.throws, details, tv)) sigFlags.push('throws');
  if (tvo(o.typeParams) !== tvn(n.typeParams)) {
    sigFlags.push('typeParams');
    details.push(`tip parametreleri: ${o.typeParams ?? '-'} → ${n.typeParams ?? '-'}`);
  }
  if (tvo(o.fieldType) !== tvn(n.fieldType) && (o.kind === 'field' || n.kind === 'field')) {
    sigFlags.push('fieldType');
    details.push(`alan tipi: ${o.fieldType ?? '-'} → ${n.fieldType ?? '-'}`);
  }
  const flags: ChangeFlag[] = [...sigFlags];
  let bodyChanged = o.normalizedBody !== n.normalizedBody;
  let normalizedChanged = o.normalizedText !== n.normalizedText;
  let textChanged = o.text !== n.text;
  let tvRenamed = false;
  if (tv.active) {
    // Tip değişkeni adı değişimi (T -> E) gövde/metin farkı sayılmaz; tokenlar üzerinde pozisyonel adla karşılaştır.
    if (bodyChanged && tv.o(bodyTokens(o).join(' ')) === tv.n(bodyTokens(n).join(' '))) bodyChanged = false;
    if (normalizedChanged && tv.o(o.normalizedText) === tv.n(n.normalizedText)) normalizedChanged = false;
    if (textChanged && tv.o(o.text) === tv.n(n.text)) {
      textChanged = false;
      tvRenamed = true;
    } else {
      tvRenamed = o.normalizedText !== n.normalizedText && !normalizedChanged;
    }
  }
  const javadocChanged = (o.javadoc ?? '') !== (n.javadoc ?? '');
  if (bodyChanged) {
    if (o.kind === 'field') {
      flags.push('initializer');
      const a = shortText(o.initializerText);
      const b = shortText(n.initializerText);
      if (!o.initializerText) details.push(`başlatıcı eklendi: ${b}`);
      else if (!n.initializerText) details.push(`başlatıcı kaldırıldı: ${a}`);
      else details.push(`başlatıcı değişti: ${a} → ${b}`);
    } else {
      flags.push('body');
      details.push(`gövde değişti (+${delta.added}/\u2212${delta.removed} satır)`);
    }
  }
  if (o.complexity !== n.complexity) details.push(`karmaşıklık ${o.complexity} → ${n.complexity}`);
  return { tvRenamed, sigFlags, flags, details, bodyChanged, textChanged, normalizedChanged, javadocChanged };
}

function baseChange(m: JavaMember, ownerTypeId: string, status: ChangeStatus): MemberChange {
  return {
    id: m.id,
    kind: m.kind,
    name: m.name,
    ownerTypeId,
    signature: m.signature,
    visibility: m.visibility,
    status,
    flags: [],
    details: [],
    linesAdded: 0,
    linesRemoved: 0,
    overrides: [],
    overriddenBy: [],
    callers: [],
    callees: [],
    risk: emptyRisk(),
  };
}

function addedDiff(n: JavaMember, ownerTypeId: string): MemberDiff {
  const c = baseChange(n, ownerTypeId, 'added');
  c.newRange = n.range;
  c.linesAdded = lineCountOf(fullText(n));
  return { change: c, newMember: n };
}

function removedDiff(o: JavaMember, ownerTypeId: string): MemberDiff {
  const c = baseChange(o, ownerTypeId, 'removed');
  c.oldRange = o.range;
  c.linesRemoved = lineCountOf(fullText(o));
  return { change: c, oldMember: o };
}

/** Eşleşmiş iki üyeden MemberDiff üretir. forced: renamed / moved. */
function pairDiff(
  o: JavaMember,
  n: JavaMember,
  ownerTypeId: string,
  forced?: 'renamed' | 'moved',
  tv?: TvCtx,
): MemberDiff {
  const delta = lineDelta(fullText(o), fullText(n));
  const cmp = compareMembers(o, n, delta, tv);
  let status: ChangeStatus;
  const flags = [...cmp.flags];
  const details = [...cmp.details];
  if (forced) {
    status = forced;
    if (cmp.javadocChanged) flags.push('javadoc');
    if (!cmp.normalizedChanged && cmp.textChanged && !flags.includes('body')) flags.push('formatting');
  } else if (cmp.sigFlags.length > 0) {
    status = 'signatureChanged';
    if (cmp.javadocChanged) {
      flags.push('javadoc');
      details.push('javadoc değişti');
    }
  } else if (cmp.normalizedChanged || cmp.bodyChanged) {
    status = 'modified';
    if (cmp.javadocChanged) {
      flags.push('javadoc');
      details.push('javadoc değişti');
    }
    if (details.length === 0) details.push('bildirim değişti');
  } else if (cmp.textChanged || cmp.javadocChanged || cmp.tvRenamed) {
    status = 'cosmetic';
    if (cmp.tvRenamed) {
      flags.push('formatting');
      details.push('tip parametresi adı değişti');
    }
    if (cmp.textChanged) {
      flags.push('formatting');
      details.push('yalnızca biçim/boşluk');
    }
    if (cmp.javadocChanged) {
      flags.push('javadoc');
      details.push('yalnızca javadoc');
    }
  } else {
    status = 'unchanged';
    details.length = 0;
  }
  const c = baseChange(n, ownerTypeId, status);
  c.flags = flags;
  c.details = details;
  c.oldRange = o.range;
  c.newRange = n.range;
  if (status !== 'unchanged') {
    c.linesAdded = delta.added;
    c.linesRemoved = delta.removed;
  }
  if (o.id !== n.id) c.oldId = o.id;
  if (o.name !== n.name) c.oldName = o.name;
  if (o.signature !== n.signature) c.oldSignature = o.signature;
  return { change: c, oldMember: o, newMember: n };
}

// ---------------------------------------------------------------------------
// Üye eşleme
// ---------------------------------------------------------------------------

/** Sahip tipten bağımsız anahtar: tip yeniden adlandırılsa da eşleşsin. */
function localKey(m: JavaMember): string {
  const rest = m.id.startsWith(m.ownerFqn) ? m.id.slice(m.ownerFqn.length) : m.id;
  if (m.kind === 'constructor') {
    const p = rest.indexOf('(');
    return `#<ctor>${p >= 0 ? rest.slice(p) : ''}`;
  }
  return rest;
}

function paramScore(o: JavaMember, n: JavaMember, tv?: TvCtx): number {
  const norm = tvNormFor(o, n, tv);
  const ot = o.params.map((p) => eraseTypeForId(norm.o(p.type)));
  const nt = n.params.map((p) => eraseTypeForId(norm.n(p.type)));
  if (ot.length === 0 && nt.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const t of ot) counts.set(t, (counts.get(t) ?? 0) + 1);
  let inter = 0;
  for (const t of nt) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(t, c - 1);
    }
  }
  const typeSim = (2 * inter) / (ot.length + nt.length);
  const names = new Set(o.params.map((p) => p.name));
  const nameInter = n.params.filter((p) => names.has(p.name)).length;
  const nameSim = (2 * nameInter) / (o.params.length + n.params.length);
  return 0.6 * typeSim + 0.4 * nameSim;
}

function matchMembers(olds: JavaMember[], news: JavaMember[], ownerTypeId: string, tv?: TvCtx): MemberDiff[] {
  const pairs = new Map<JavaMember, { o: JavaMember; forced?: 'renamed' }>(); // new -> old
  const usedOld = new Set<JavaMember>();

  // (1) aynı id (sahipten bağımsız)
  const newByKey = new Map<string, JavaMember>();
  for (const n of news) if (!newByKey.has(localKey(n))) newByKey.set(localKey(n), n);
  for (const o of olds) {
    const n = newByKey.get(localKey(o));
    if (n && !pairs.has(n) && n.kind === o.kind) {
      pairs.set(n, { o });
      usedOld.add(o);
    }
  }

  // (2) aynı ad + tür (imza değişikliği / aşırı yükleme)
  const group = (list: JavaMember[], used: (m: JavaMember) => boolean): Map<string, JavaMember[]> => {
    const g = new Map<string, JavaMember[]>();
    for (const m of list) {
      if (used(m) || m.kind === 'initializer') continue;
      const key = `${m.kind}|${m.kind === 'constructor' ? '<ctor>' : m.name}`;
      const arr = g.get(key);
      if (arr) arr.push(m);
      else g.set(key, [m]);
    }
    return g;
  };
  const oldGroups = group(olds, (m) => usedOld.has(m));
  const newGroups = group(news, (m) => pairs.has(m));
  for (const [key, os] of oldGroups) {
    const ns = newGroups.get(key);
    if (!ns) continue;
    if (os.length === 1 && ns.length === 1) {
      const o = os[0] as JavaMember;
      const n = ns[0] as JavaMember;
      pairs.set(n, { o });
      usedOld.add(o);
      continue;
    }
    const cands: Candidate<JavaMember, JavaMember>[] = [];
    for (const o of os) {
      for (const n of ns) {
        const score = 0.7 * paramScore(o, n, tv) + 0.3 * memberSimilarity(o, n);
        if (score >= 0.3) cands.push({ a: o, b: n, score });
      }
    }
    for (const c of greedyPairs(cands)) {
      pairs.set(c.b, { o: c.a });
      usedOld.add(c.a);
    }
  }

  // (3) gövde benzerliğiyle yeniden adlandırma
  const restOld = olds.filter((o) => !usedOld.has(o) && o.kind !== 'initializer');
  const restNew = news.filter((n) => !pairs.has(n) && n.kind !== 'initializer');
  if (restOld.length > 0 && restNew.length > 0) {
    for (const c of greedyPairs(similarityCandidates(restOld, restNew, RENAME_THRESHOLD))) {
      pairs.set(c.b, { o: c.a, forced: 'renamed' });
      usedOld.add(c.a);
    }
  }

  // Sonuç: yeni sırada; kaldırılanlar eski komşusunun arkasına
  const result: { key: number; md: MemberDiff }[] = [];
  const newIndex = new Map<JavaMember, number>();
  news.forEach((n, i) => newIndex.set(n, i));
  const oldToNewPos = new Map<JavaMember, number>();
  news.forEach((n, i) => {
    const p = pairs.get(n);
    if (p) oldToNewPos.set(p.o, i);
  });
  news.forEach((n, i) => {
    const p = pairs.get(n);
    const md = p ? pairDiff(p.o, n, ownerTypeId, p.forced, tv) : addedDiff(n, ownerTypeId);
    result.push({ key: i, md });
  });
  let lastPos = -1;
  olds.forEach((o, j) => {
    const pos = oldToNewPos.get(o);
    if (pos !== undefined) {
      lastPos = pos;
      return;
    }
    if (usedOld.has(o)) return;
    result.push({ key: lastPos + 0.5 + j / (olds.length + 1) / 2, md: removedDiff(o, ownerTypeId) });
  });
  result.sort((a, b) => a.key - b.key);
  return result.map((r) => r.md);
}

// ---------------------------------------------------------------------------
// Tip karşılaştırma
// ---------------------------------------------------------------------------

function packageOf(t: JavaType, file: JavaFileModel | undefined): string {
  if (file) return file.packageName;
  const idx = t.fqn.lastIndexOf('.');
  return idx >= 0 ? t.fqn.slice(0, idx) : '';
}

function superTypesOfType(t: JavaType): string[] {
  return [...(t.superclass ? [t.superclass] : []), ...t.interfaces];
}

/** extends/implements kümesi değişti mi (arayüz sırası önemsiz). */
function superChanged(o: JavaType, n: JavaType): boolean {
  if ((o.superclass ?? '') !== (n.superclass ?? '')) return true;
  const oi = new Set(o.interfaces);
  const ni = new Set(n.interfaces);
  return oi.size !== ni.size || [...ni].some((i) => !oi.has(i));
}

/** Tipin ve (statik olmayan iç sınıfsa) dış tiplerinin tip değişkenleri, dıştan içe. */
function classVarsOf(t: JavaType | undefined, file: JavaFileModel | undefined): string[] {
  const chain: JavaType[] = [];
  for (let cur = t; cur; ) {
    chain.unshift(cur);
    if (!cur.outerFqn || cur.modifiers.includes('static') || cur.kind !== 'class') break;
    const outerFqn = cur.outerFqn;
    cur = file?.types.find((x) => x.fqn === outerFqn);
  }
  return chain.flatMap((x) => typeParamNames(x.typeParams));
}

function compareTypeHeaders(o: JavaType, n: JavaType): { flags: ChangeFlag[]; details: string[]; changed: boolean } {
  const flags: ChangeFlag[] = [];
  const details: string[] = [];
  let changed = false;
  if (o.kind !== n.kind) {
    details.push(`tür: ${o.kind} → ${n.kind}`);
    changed = true;
  }
  if (o.visibility !== n.visibility) {
    flags.push('visibility');
    details.push(`görünürlük: ${o.visibility} → ${n.visibility}`);
  }
  if (compareModifiers(o.modifiers, n.modifiers, details)) flags.push('modifiers');
  if (compareAnnotations(o.annotations, n.annotations, details)) flags.push('annotations');
  if (noWs(o.typeParams) !== noWs(n.typeParams)) {
    const ov = typeParamNames(o.typeParams);
    const nv = typeParamNames(n.typeParams);
    const on = renameTypeVars(o.typeParams ?? '', typeVarMap(ov, []));
    const nn = renameTypeVars(n.typeParams ?? '', typeVarMap(nv, []));
    if (noWs(on) === noWs(nn)) details.push(`tip parametresi adı değişti: ${o.typeParams ?? '-'} → ${n.typeParams ?? '-'}`);
    else {
      flags.push('typeParams');
      details.push(`tip parametreleri: ${o.typeParams ?? '-'} → ${n.typeParams ?? '-'}`);
    }
  }
  if ((o.superclass ?? '') !== (n.superclass ?? '')) {
    changed = true;
    if (!o.superclass) details.push(`üst sınıf eklendi: ${n.superclass ?? ''}`);
    else if (!n.superclass) details.push(`üst sınıf kaldırıldı: ${o.superclass}`);
    else details.push(`üst sınıf: ${o.superclass} → ${n.superclass}`);
  }
  const word = n.kind === 'interface' ? 'extends' : 'implements';
  const oi = new Set(o.interfaces);
  const ni = new Set(n.interfaces);
  for (const i of n.interfaces) {
    if (!oi.has(i)) {
      details.push(`${word} eklendi: ${i}`);
      changed = true;
    }
  }
  for (const i of o.interfaces) {
    if (!ni.has(i)) {
      details.push(`${word} kaldırıldı: ${i}`);
      changed = true;
    }
  }
  if (superChanged(o, n)) flags.push('supertypes');
  return { flags, details, changed: changed || flags.length > 0 };
}

function memberSummary(members: MemberDiff[]): string | undefined {
  const counts = new Map<ChangeStatus, number>();
  for (const m of members) counts.set(m.change.status, (counts.get(m.change.status) ?? 0) + 1);
  const labels: [ChangeStatus, string][] = [
    ['added', 'eklendi'],
    ['removed', 'kaldırıldı'],
    ['signatureChanged', 'imzası değişti'],
    ['modified', 'değişti'],
    ['renamed', 'yeniden adlandırıldı'],
    ['moved', 'taşındı'],
    ['cosmetic', 'biçimsel'],
  ];
  const parts = labels.filter(([s]) => counts.get(s)).map(([s, l]) => `${counts.get(s) ?? 0} ${l}`);
  return parts.length ? `üyeler: ${parts.join(', ')}` : undefined;
}

function setSummary(td: TypeDiff): void {
  td.change.details = td.change.details.filter((d) => !d.startsWith('üyeler: '));
  if (td.change.status === 'unchanged') return;
  const s = memberSummary(td.members);
  if (s) td.change.details.push(s);
}

function buildTypeDiff(
  oldT: JavaType | undefined,
  newT: JavaType | undefined,
  oldFile: JavaFileModel | undefined,
  newFile: JavaFileModel | undefined,
  filePath: string,
  pairKind?: 'renamed' | 'moved',
): TypeDiff {
  const t = (newT ?? oldT) as JavaType;
  const id = t.fqn;
  let members: MemberDiff[];
  let status: ChangeStatus;
  let flags: ChangeFlag[] = [];
  let details: string[] = [];
  if (oldT && newT) {
    const tv: TvCtx = { oldVars: classVarsOf(oldT, oldFile), newVars: classVarsOf(newT, newFile) };
    members = matchMembers(oldT.members, newT.members, id, tv);
    const hdr = compareTypeHeaders(oldT, newT);
    flags = hdr.flags;
    details = hdr.details;
    const javadocChanged = (oldT.javadoc ?? '') !== (newT.javadoc ?? '');
    if (pairKind) {
      status = pairKind;
      if (oldT.name !== newT.name) details.unshift(`ad değişti: ${oldT.name} → ${newT.name}`);
      const op = packageOf(oldT, oldFile);
      const np = packageOf(newT, newFile);
      if (op !== np) details.unshift(`paket değişti: ${op || '(varsayılan)'} → ${np || '(varsayılan)'}`);
    } else if (hdr.changed) {
      status = 'signatureChanged';
    } else {
      const statuses = new Set(members.map((m) => m.change.status));
      const onlyUnchanged = [...statuses].every((s) => s === 'unchanged');
      const onlyCosmetic = [...statuses].every((s) => s === 'unchanged' || s === 'cosmetic');
      if (onlyUnchanged && !javadocChanged && oldT.normalizedText === newT.normalizedText) status = 'unchanged';
      else if (onlyCosmetic) {
        status = 'cosmetic';
        const memberFlags = new Set(members.flatMap((m) => m.change.flags));
        if (memberFlags.has('formatting') || oldT.normalizedText !== newT.normalizedText) {
          flags.push('formatting');
          details.push('yalnızca biçim/boşluk');
        }
        if (memberFlags.has('javadoc') || javadocChanged) {
          flags.push('javadoc');
          details.push('yalnızca javadoc');
        }
        if (flags.length === 0) flags.push('formatting');
      } else status = 'modified';
    }
    if (javadocChanged && status !== 'cosmetic' && status !== 'unchanged') flags.push('javadoc');
    if (status !== 'unchanged' && status !== 'cosmetic' && members.some((m) => !['unchanged', 'cosmetic'].includes(m.change.status))) {
      flags.push('body');
    }
  } else if (newT) {
    members = newT.members.map((m) => addedDiff(m, id));
    status = 'added';
  } else {
    members = (oldT as JavaType).members.map((m) => removedDiff(m, id));
    status = 'removed';
  }
  const change: TypeChange = {
    id,
    name: t.name,
    kind: t.kind,
    file: filePath,
    status,
    flags: [...new Set(flags)],
    details,
    visibility: t.visibility,
    annotations: t.annotations,
    superTypes: superTypesOfType(t),
    subTypes: [],
    members: members.map((m) => m.change),
    layer: 'other',
    risk: emptyRisk(),
  };
  if (oldT) {
    change.oldSuperTypes = superTypesOfType(oldT);
    change.oldRange = oldT.range;
    if (oldT.fqn !== id) change.oldId = oldT.fqn;
  }
  if (newT) change.newRange = newT.range;
  const td: TypeDiff = { change, members };
  if (oldT) td.oldType = oldT;
  if (newT) td.newType = newT;
  if (oldFile) td.oldFile = oldFile;
  if (newFile) td.newFile = newFile;
  setSummary(td);
  return td;
}

/** Tip benzerliği: sahipten bağımsız üye anahtarı veya özdeş gövde eşleşmesi oranı (Dice). */
function typeSimilarity(o: JavaType, n: JavaType): number {
  if (o.members.length === 0 && n.members.length === 0) {
    return o.kind === n.kind && o.normalizedText.replace(o.name, '') === n.normalizedText.replace(n.name, '') ? 1 : 0;
  }
  const keys = new Map<string, number>();
  const bodies = new Map<string, number>();
  for (const m of o.members) {
    keys.set(localKey(m), (keys.get(localKey(m)) ?? 0) + 1);
    if (m.normalizedBody) bodies.set(m.normalizedBody, (bodies.get(m.normalizedBody) ?? 0) + 1);
  }
  let matched = 0;
  for (const m of n.members) {
    const k = localKey(m);
    const kc = keys.get(k) ?? 0;
    if (kc > 0) {
      keys.set(k, kc - 1);
      matched++;
      continue;
    }
    const bc = m.normalizedBody ? (bodies.get(m.normalizedBody) ?? 0) : 0;
    if (bc > 0) {
      bodies.set(m.normalizedBody, bc - 1);
      matched++;
    }
  }
  return (2 * matched) / (o.members.length + n.members.length);
}

/**
 * İki dosya modelinin tip/üye düzeyinde semantik farkı.
 * Eklenen dosyada oldModel, silinende newModel undefined. Değişmeyen tipler de (status 'unchanged') döner.
 */
export function diffJavaFile(
  oldModel: JavaFileModel | undefined,
  newModel: JavaFileModel | undefined,
  opts: DiffFileOptions = {},
): TypeDiff[] {
  const oldTypes = oldModel?.types ?? [];
  const newTypes = newModel?.types ?? [];
  const newPath = opts.newPath ?? newModel?.path ?? opts.oldPath ?? oldModel?.path ?? '';
  const oldPath = opts.oldPath ?? oldModel?.path ?? newPath;
  const oldByFqn = new Map(oldTypes.map((t) => [t.fqn, t]));
  const matchedOld = new Set<JavaType>();
  const pairOf = new Map<JavaType, { o: JavaType; kind?: 'renamed' | 'moved' }>();
  for (const n of newTypes) {
    const o = oldByFqn.get(n.fqn);
    if (o && !matchedOld.has(o)) {
      pairOf.set(n, { o });
      matchedOld.add(o);
    }
  }
  // B7: git yeniden adlandırması + iki tarafta tek üst düzey tip: eşik aranmadan eşle; iç tipleri göreli adla eşle.
  if (opts.fileRenamed) {
    const oldTop = oldTypes.filter((t) => !t.outerFqn);
    const newTop = newTypes.filter((t) => !t.outerFqn);
    const ot = oldTop[0];
    const nt = newTop[0];
    if (oldTop.length === 1 && newTop.length === 1 && ot && nt && !matchedOld.has(ot) && !pairOf.has(nt)) {
      const kindOf = (o: JavaType, n: JavaType): 'renamed' | 'moved' =>
        packageOf(o, oldModel) !== packageOf(n, newModel) ? 'moved' : 'renamed';
      pairOf.set(nt, { o: ot, kind: kindOf(ot, nt) });
      matchedOld.add(ot);
      const oldByRel = new Map<string, JavaType>();
      for (const o of oldTypes) {
        if (o !== ot && !matchedOld.has(o) && o.fqn.startsWith(`${ot.fqn}.`)) oldByRel.set(o.fqn.slice(ot.fqn.length), o);
      }
      for (const n of newTypes) {
        if (n === nt || pairOf.has(n) || !n.fqn.startsWith(`${nt.fqn}.`)) continue;
        const o = oldByRel.get(n.fqn.slice(nt.fqn.length));
        if (o && !matchedOld.has(o)) {
          pairOf.set(n, { o, kind: kindOf(o, n) });
          matchedOld.add(o);
        }
      }
    }
  }
  const restOld = oldTypes.filter((o) => !matchedOld.has(o));
  const restNew = newTypes.filter((n) => !pairOf.has(n));
  if (restOld.length && restNew.length) {
    const cands: Candidate<JavaType, JavaType>[] = [];
    for (const o of restOld) {
      for (const n of restNew) {
        const s = typeSimilarity(o, n);
        if (s >= TYPE_MATCH_THRESHOLD) cands.push({ a: o, b: n, score: s + (o.name === n.name ? 0.01 : 0) });
      }
    }
    for (const c of greedyPairs(cands)) {
      const op = packageOf(c.a, oldModel);
      const np = packageOf(c.b, newModel);
      const outerChanged = (c.a.outerFqn ?? '') !== (c.b.outerFqn ?? '');
      const kind: 'renamed' | 'moved' = op !== np || (outerChanged && c.a.name === c.b.name) ? 'moved' : 'renamed';
      pairOf.set(c.b, { o: c.a, kind });
      matchedOld.add(c.a);
    }
  }
  const out: TypeDiff[] = [];
  for (const n of newTypes) {
    const p = pairOf.get(n);
    out.push(buildTypeDiff(p?.o, n, p ? oldModel : undefined, newModel, newPath, p?.kind));
  }
  for (const o of oldTypes) {
    if (matchedOld.has(o)) continue;
    out.push(buildTypeDiff(o, undefined, oldModel, undefined, oldModel && !newModel ? oldPath : newPath));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dosyalar arası taşıma
// ---------------------------------------------------------------------------

interface Located {
  td: TypeDiff;
  md: MemberDiff;
  member: JavaMember;
}

/**
 * Farklı tiplerdeki kaldırılan + eklenen metot çiftlerini gövde benzerliğiyle (>= 0.85) eşler;
 * yeni taraftaki kayıt 'moved' olur, eski taraftaki 'removed' kayıt kendi TypeDiff'inden çıkarılır. Yerinde değiştirir.
 */
export function detectCrossFileMoves(diffs: TypeDiff[]): void {
  const removed: Located[] = [];
  const added: Located[] = [];
  for (const td of diffs) {
    for (const md of td.members) {
      if (md.change.status === 'removed' && md.oldMember?.kind === 'method') {
        removed.push({ td, md, member: md.oldMember });
      } else if (md.change.status === 'added' && md.newMember?.kind === 'method') {
        added.push({ td, md, member: md.newMember });
      }
    }
  }
  if (removed.length === 0 || added.length === 0) return;

  const ownerOf = (l: Located): string => l.md.change.ownerTypeId;
  const testSide = new Map<TypeDiff, boolean>();
  const isTest = (l: Located): boolean => {
    let v = testSide.get(l.td);
    if (v === undefined) {
      v = isTestPath(l.td.change.file);
      testSide.set(l.td, v);
    }
    return v;
  };
  const usedR = new Set<Located>();
  const usedA = new Set<Located>();
  const chosen: Candidate<Located, Located>[] = [];

  const runPass = (sameNameOnly: boolean): void => {
    const rs = removed.filter((r) => !usedR.has(r));
    const as = added.filter((a) => !usedA.has(a));
    const byName = new Map<string, Located[]>();
    for (const a of as) {
      const arr = byName.get(a.member.name);
      if (arr) arr.push(a);
      else byName.set(a.member.name, [a]);
    }
    const cands: Candidate<Located, Located>[] = [];
    for (const r of rs) {
      const pool = sameNameOnly ? (byName.get(r.member.name) ?? []) : as;
      const br = bagOf(r.member);
      for (const a of pool) {
        if (ownerOf(a) === ownerOf(r) || a.td === r.td) continue;
        if (isTest(a) !== isTest(r)) continue; // B6: test kökü <-> üretim kökü taşıması sayılmaz
        if (upperBound(br, bagOf(a.member)) < RENAME_THRESHOLD) continue;
        if (!significantPair(r.member, a.member)) continue;
        const s = memberSimilarity(r.member, a.member);
        if (s >= RENAME_THRESHOLD) cands.push({ a: r, b: a, score: s });
      }
    }
    const countR = new Map<Located, number>();
    const countA = new Map<Located, number>();
    for (const c of cands) {
      countR.set(c.a, (countR.get(c.a) ?? 0) + 1);
      countA.set(c.b, (countA.get(c.b) ?? 0) + 1);
    }
    const filtered = cands.filter(
      (c) =>
        !(isTrivial(c.a.member) || isTrivial(c.b.member)) || (countR.get(c.a) === 1 && countA.get(c.b) === 1),
    );
    for (const c of greedyPairs(filtered)) {
      usedR.add(c.a);
      usedA.add(c.b);
      chosen.push(c);
    }
  };
  runPass(true);
  runPass(false);

  const touched = new Set<TypeDiff>();
  for (const { a: r, b: a } of chosen) {
    const o = r.member;
    const n = a.member;
    const tv: TvCtx = {
      oldVars: classVarsOf(r.td.oldType, r.td.oldFile),
      newVars: classVarsOf(a.td.newType, a.td.newFile),
    };
    const moved = pairDiff(o, n, ownerOf(a), 'moved', tv);
    const fromType = simpleName(ownerOf(r));
    const toType = simpleName(ownerOf(a));
    // aynı nesne referansını koru (TypeChange.members ile paylaşılıyor)
    const target = a.md.change;
    Object.assign(target, moved.change, {
      details: [`taşındı: ${fromType} → ${toType}`, ...moved.change.details],
      oldId: o.id,
      oldName: o.name,
      oldRange: o.range,
      oldSignature: o.signature,
    });
    if (o.visibility !== n.visibility && !target.flags.includes('visibility')) target.flags.push('visibility');
    a.md.oldMember = o;

    const idx = r.td.members.indexOf(r.md);
    if (idx >= 0) r.td.members.splice(idx, 1);
    const cidx = r.td.change.members.indexOf(r.md.change);
    if (cidx >= 0) r.td.change.members.splice(cidx, 1);
    r.td.change.details.push(`üye taşındı: ${o.name} → ${toType}`);
    touched.add(r.td);
    touched.add(a.td);
  }
  for (const td of touched) setSummary(td);
}

import type { ChangeStatus, FileOutline, Range, SymbolDecl, SymbolKind, SymbolLocation, SymbolRef, TypeKind } from '../../../src/shared/types';
import { sampleFiles } from './sampleFiles';
import { sampleReview } from './sampleReview';

/**
 * Mock `/outline` ve `/locate`: örnek kaynaklar üzerinde hafif bir Java tarayıcısı.
 * Gerçek sunucu tree-sitter + repo indeksi kullanır; burada amaç arayüzün gerçekçi veriyle çalışmasıdır:
 * bildirimler (tip, metot, kurucu, alan) kimlikleri ReviewModel'deki biçimle aynıdır ('Tip#ad(ParamTip,…)'),
 * referanslar alıcının (alan/parametre/yerel değişken) tipine göre çözülür; çözülemeyen çağrı ad eşleşmesine düşer.
 */

const TYPE_RE = /\b(class|interface|enum|record|@interface)\s+([A-Z]\w*)/;
const MODS = '(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp|transient|volatile)\\s+)*';
const METHOD_RE = new RegExp(`^\\s*${MODS}(?:<[^>]+>\\s+)?(?:([\\w.$<>\\[\\],?]+(?:\\s*<[^()]*>)?(?:\\[\\])*)\\s+)?([A-Za-z_$][\\w$]*)\\s*\\(`);
const FIELD_RE = new RegExp(`^\\s*${MODS}([\\w.$]+(?:<[^;=()]*>)?(?:\\[\\])*)\\s+([A-Za-z_$][\\w$]*)\\s*(=|;)`);
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw', 'else', 'try', 'do', 'synchronized', 'super', 'this',
  'public', 'protected', 'private', 'static', 'final', 'abstract', 'class', 'interface', 'enum', 'record', 'extends', 'implements',
  'import', 'package', 'void', 'boolean', 'int', 'long', 'double', 'float', 'char', 'byte', 'short', 'null', 'true', 'false',
  'throws', 'instanceof', 'var', 'default', 'case', 'break', 'continue', 'assert',
]);

interface ScannedType {
  decl: SymbolDecl;
  name: string;
  supers: string[];
}

interface ScannedFile {
  path: string;
  side: 'old' | 'new';
  packageName?: string;
  lines: string[];
  masked: string[];
  decls: SymbolDecl[];
  types: ScannedType[];
  /** Değişken/alan/parametre adı → basit tip adı. */
  vars: Map<string, string>;
  abstractIds: Set<string>;
}

/** Yorum ve metin sabitlerini aynı uzunlukta boşlukla örter (sütunlar korunur). */
export function maskJava(lines: readonly string[]): string[] {
  let inBlock = false;
  return lines.map((line) => {
    let out = '';
    let i = 0;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      if (inBlock) {
        if (two === '*/') {
          inBlock = false;
          out += '  ';
          i += 2;
        } else {
          out += ' ';
          i++;
        }
      } else if (two === '/*') {
        inBlock = true;
        out += '  ';
        i += 2;
      } else if (two === '//') {
        out += ' '.repeat(line.length - i);
        break;
      } else if (line[i] === '"' || line[i] === "'") {
        const q = line[i];
        out += q;
        i++;
        while (i < line.length && line[i] !== q) {
          const esc = line[i] === '\\';
          out += esc ? '  ' : ' ';
          i += esc ? 2 : 1;
        }
        if (i < line.length) {
          out += q;
          i++;
        }
      } else {
        out += line[i];
        i++;
      }
    }
    return out.slice(0, line.length);
  });
}

function simpleType(t: string): string {
  const noGen = t.replace(/<.*>/g, '').trim();
  const dims = (noGen.match(/\[\]/g) ?? []).join('');
  const base = noGen.replace(/\[\]/g, '').replace(/\.\.\.$/, '');
  return `${base.slice(base.lastIndexOf('.') + 1)}${dims}${noGen.endsWith('...') ? '...' : ''}`;
}

/** Üst düzey virgüllerle böler (generics ve parantez içi korunur). */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(') depth++;
    else if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** `(`'dan sonra eşleşen `)`'a kadar metin (birden çok satıra yayılabilir). */
function parenText(masked: readonly string[], line: number, col: number): { text: string; endLine: number } {
  let depth = 0;
  let text = '';
  for (let l = line; l < masked.length; l++) {
    const s = masked[l] ?? '';
    for (let c = l === line ? col : 0; c < s.length; c++) {
      const ch = s[c];
      if (ch === '(') {
        depth++;
        if (depth === 1) continue;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) return { text, endLine: l };
      }
      text += ch;
    }
    text += ' ';
  }
  return { text, endLine: masked.length - 1 };
}

function params(text: string): { types: string[]; names: [string, string][] } {
  const types: string[] = [];
  const names: [string, string][] = [];
  for (const p of splitTop(text)) {
    const clean = p.replace(/@\w+(\([^)]*\))?\s*/g, '').replace(/\bfinal\s+/g, '').trim();
    const m = /^(.*?)\s*([A-Za-z_$][\w$]*)$/.exec(clean);
    if (!m) continue;
    const t = simpleType(m[1] ?? '');
    types.push(t);
    names.push([m[2] ?? '', t.replace(/\[\]|\.\.\./g, '')]);
  }
  return { types, names };
}

/** Bildirimin bittiği satır: gövdeli ise süslü parantez dengesi, değilse ';'. */
function declEnd(masked: readonly string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let l = start; l < masked.length; l++) {
    for (const ch of masked[l] ?? '') {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
        if (opened && depth === 0) return l;
      } else if (ch === ';' && !opened && depth === 0) {
        return l;
      }
    }
  }
  return masked.length - 1;
}

function annotationStart(masked: readonly string[], line: number): number {
  let l = line;
  while (l > 0 && (masked[l - 1] ?? '').trim().startsWith('@')) l--;
  return l;
}

function signatureOf(lines: readonly string[], start: number, end: number): string {
  const text = lines.slice(start, Math.min(end, start + 4) + 1).join(' ');
  const cut = text.search(/[{;]/);
  return (cut >= 0 ? text.slice(0, cut) : text).replace(/@\w+(\([^)]*\))?\s*/g, '').replace(/\s+/g, ' ').trim();
}

function scan(path: string, side: 'old' | 'new', content: string, status: StatusLookup): ScannedFile {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const masked = maskJava(lines);
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(content)?.[1];
  const decls: SymbolDecl[] = [];
  const types: ScannedType[] = [];
  const vars = new Map<string, string>();
  const abstractIds = new Set<string>();
  /** Açık tip bağlamları: gövde derinliği ve kapanış satırı. */
  const stack: { type: ScannedType; bodyDepth: number; endLine: number }[] = [];
  let depth = 0;

  for (let l = 0; l < masked.length; l++) {
    const m = masked[l] ?? '';
    while (stack.length > 0 && (stack[stack.length - 1]?.endLine ?? 0) < l) stack.pop();
    const top = stack[stack.length - 1];
    const tm = TYPE_RE.exec(m);
    if (tm && !/^\s*(import|package)\b/.test(m)) {
      const name = tm[2] ?? '';
      const kind = (tm[1] === '@interface' ? 'annotation' : tm[1]) as TypeKind;
      const id = top ? `${top.type.decl.id}.${name}` : pkg ? `${pkg}.${name}` : name;
      const nameCol = m.indexOf(name, (tm.index ?? 0) + (tm[1]?.length ?? 0));
      const end = declEnd(masked, l);
      const head = m.slice(nameCol + name.length).split('{')[0] ?? '';
      const supers = [...head.matchAll(/\b(?:extends|implements)\s+([^{]+)/g)].flatMap((x) => splitTop((x[1] ?? '').replace(/\b(extends|implements)\b/g, ',')).map(simpleType));
      const decl: SymbolDecl = {
        id,
        kind,
        name,
        signature: signatureOf(lines, l, end),
        ownerTypeId: top?.type.decl.id,
        range: { startLine: annotationStart(masked, l) + 1, endLine: end + 1 },
        nameLine: l + 1,
        nameStartCol: nameCol,
        nameEndCol: nameCol + name.length,
        status: status(id, side),
      };
      const st: ScannedType = { decl, name, supers };
      decls.push(decl);
      types.push(st);
      stack.push({ type: st, bodyDepth: depth + 1, endLine: end });
      if (kind === 'record') {
        const open = m.indexOf('(', nameCol);
        if (open >= 0) for (const [n, t] of params(parenText(masked, l, open).text).names) vars.set(n, t);
      }
    } else if (top && depth === top.bodyDepth) {
      const mm = METHOD_RE.exec(m);
      const fm = FIELD_RE.exec(m);
      const name = mm?.[2];
      if (mm && name && !KEYWORDS.has(name) && (mm[1] === undefined ? name === top.type.name : !KEYWORDS.has(mm[1]) || mm[1] === 'void' || /^(boolean|int|long|double|float|char|byte|short)$/.test(mm[1]))) {
        const ctor = mm[1] === undefined;
        const nameCol = m.search(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\s*\\(`));
        const open = m.indexOf('(', nameCol + name.length);
        const p = params(parenText(masked, l, open).text);
        for (const [n, t] of p.names) vars.set(n, t);
        const end = declEnd(masked, l);
        const id = `${top.type.decl.id}#${name}(${p.types.join(',')})`;
        const kind: SymbolKind = ctor ? 'constructor' : 'method';
        if (/\babstract\b/.test(m) || (top.type.decl.kind === 'interface' && !/\b(default|static)\b/.test(m))) abstractIds.add(id);
        decls.push({
          id,
          kind,
          name,
          signature: signatureOf(lines, l, end),
          ownerTypeId: top.type.decl.id,
          range: { startLine: annotationStart(masked, l) + 1, endLine: end + 1 },
          nameLine: l + 1,
          nameStartCol: nameCol,
          nameEndCol: nameCol + name.length,
          status: status(id, side),
        });
      } else if (fm && !KEYWORDS.has(fm[1] ?? '') && !/^\s*(return|throw)\b/.test(m)) {
        const name = fm[2] ?? '';
        const t = simpleType(fm[1] ?? '');
        vars.set(name, t);
        const nameCol = m.indexOf(name, (fm.index ?? 0) + m.indexOf(fm[1] ?? '') + (fm[1]?.length ?? 0));
        const id = `${top.type.decl.id}#${name}`;
        decls.push({
          id,
          kind: 'field',
          name,
          signature: signatureOf(lines, l, l).replace(/\s*=.*$/, ''),
          ownerTypeId: top.type.decl.id,
          range: { startLine: annotationStart(masked, l) + 1, endLine: declEnd(masked, l) + 1 },
          nameLine: l + 1,
          nameStartCol: nameCol,
          nameEndCol: nameCol + name.length,
          status: status(id, side),
        });
      }
    }
    // Yerel değişkenler: 'Tip ad =', 'Tip ad;', 'for (Tip ad :'
    for (const v of m.matchAll(/\b([A-Z][\w$]*)(?:<[^>]*>)?\s+([a-z_$][\w$]*)\s*[=;:)]/g)) vars.set(v[2] ?? '', v[1] ?? '');
    for (const ch of m) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  return { path, side, packageName: pkg, lines, masked, decls, types, vars, abstractIds };
}

type StatusLookup = (id: string, side: 'old' | 'new') => ChangeStatus | undefined;

/** ReviewModel'deki değişen sembollerin durumu (eski tarafta eski kimlikle de aranır). */
function buildStatusLookup(): StatusLookup {
  const byId = new Map<string, ChangeStatus>();
  const byOld = new Map<string, ChangeStatus>();
  for (const t of sampleReview.types) {
    byId.set(t.id, t.status);
    for (const m of t.members) {
      byId.set(m.id, m.status);
      if (m.oldId) byOld.set(m.oldId, m.status);
    }
  }
  return (id, side) => {
    const s = (side === 'old' ? (byOld.get(id) ?? byId.get(id)) : byId.get(id)) ?? undefined;
    return s && s !== 'unchanged' ? s : undefined;
  };
}

interface Table {
  files: Map<string, ScannedFile>;
  /** Basit tip adı → tip. */
  typesByName: Map<string, ScannedType>;
  /** Tip id → üye bildirimleri. */
  members: Map<string, SymbolDecl[]>;
  /** Sembol id → bildirim + dosya. */
  byId: Map<string, { decl: SymbolDecl; file: ScannedFile }>;
  abstractIds: Set<string>;
}

let table: Table | null = null;

function fileKey(path: string, side: 'old' | 'new'): string {
  return `${side}:${path}`;
}

/** Tüm örnek dosyaları bir kez tarar (yeni taraf öncelikli; silinmiş dosyalar eski taraftan). */
function getTable(): Table {
  if (table) return table;
  const status = buildStatusLookup();
  const files = new Map<string, ScannedFile>();
  const typesByName = new Map<string, ScannedType>();
  const members = new Map<string, SymbolDecl[]>();
  const byId = new Map<string, { decl: SymbolDecl; file: ScannedFile }>();
  const abstractIds = new Set<string>();
  for (const [path, f] of Object.entries(sampleFiles)) {
    if (!path.endsWith('.java')) continue;
    for (const side of ['new', 'old'] as const) {
      const content = f[side];
      if (content === null || content === undefined) continue;
      const scanned = scan(path, side, content, status);
      files.set(fileKey(path, side), scanned);
      const primary = side === 'new' || f.new === null;
      if (!primary) {
        // Eski tarafta yalnız yenide olmayan semboller (silinen/yeniden adlandırılan) konum tablosuna girer.
        for (const d of scanned.decls) if (!byId.has(d.id)) byId.set(d.id, { decl: d, file: scanned });
        continue;
      }
      for (const t of scanned.types) if (!typesByName.has(t.name)) typesByName.set(t.name, t);
      for (const d of scanned.decls) {
        byId.set(d.id, { decl: d, file: scanned });
        if (d.ownerTypeId && d.kind !== 'class' && d.kind !== 'interface' && d.kind !== 'enum' && d.kind !== 'record') {
          const list = members.get(d.ownerTypeId) ?? [];
          list.push(d);
          members.set(d.ownerTypeId, list);
        }
      }
      for (const a of scanned.abstractIds) abstractIds.add(a);
    }
  }
  table = { files, typesByName, members, byId, abstractIds };
  return table;
}

function arityOf(masked: readonly string[], lineIdx: number, openCol: number): number {
  const text = parenText(masked, lineIdx, openCol).text.trim();
  return text === '' ? 0 : splitTop(text).length;
}

function declArity(d: SymbolDecl): number {
  const inner = /\(([^)]*)\)$/.exec(d.id)?.[1] ?? '';
  return inner === '' ? 0 : inner.split(',').length;
}

function methodsNamed(t: Table, typeId: string, name: string, arity: number, seen = new Set<string>()): SymbolDecl[] {
  if (seen.has(typeId)) return [];
  seen.add(typeId);
  const own = (t.members.get(typeId) ?? []).filter((d) => d.name === name && (d.kind === 'method' || d.kind === 'constructor'));
  const byArity = own.filter((d) => declArity(d) === arity);
  if (own.length > 0) return byArity.length > 0 ? byArity : own;
  // Üst tiplerde ara (bildirim kalıtılmış olabilir).
  const scanned = [...t.typesByName.values()].find((x) => x.decl.id === typeId);
  for (const s of scanned?.supers ?? []) {
    const sup = t.typesByName.get(s);
    if (sup) {
      const found = methodsNamed(t, sup.decl.id, name, arity, seen);
      if (found.length > 0) return found;
    }
  }
  return [];
}

/** Soyut metodu override eden alt tip metotları (sanal çağrının olası hedefleri). */
function overriders(t: Table, decl: SymbolDecl): SymbolDecl[] {
  const owner = [...t.typesByName.values()].find((x) => x.decl.id === decl.ownerTypeId);
  if (!owner) return [];
  const out: SymbolDecl[] = [];
  for (const sub of t.typesByName.values()) {
    if (!sub.supers.includes(owner.name)) continue;
    for (const d of t.members.get(sub.decl.id) ?? []) if (d.name === decl.name && declArity(d) === declArity(decl)) out.push(d);
  }
  return out;
}

function refsFor(t: Table, f: ScannedFile): SymbolRef[] {
  const refs: SymbolRef[] = [];
  const declAt = new Set(f.decls.map((d) => `${d.nameLine}:${d.nameStartCol}`));
  const typeAtLine = (line: number) => {
    let best: SymbolDecl | undefined;
    for (const ty of f.types) {
      const r = ty.decl.range;
      if (line >= r.startLine && line <= r.endLine && (!best || r.startLine >= best.range.startLine)) best = ty.decl;
    }
    return best;
  };
  f.masked.forEach((m, li) => {
    const lineNo = li + 1;
    if (/^\s*package\b/.test(m)) return;
    const isImport = /^\s*import\b/.test(m);
    for (const match of m.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = match[0];
      const col = match.index ?? 0;
      if (KEYWORDS.has(name) || declAt.has(`${lineNo}:${col}`)) continue;
      const before = m.slice(0, col).trimEnd();
      const after = m.slice(col + name.length).trimStart();
      if (isImport) {
        const ty = after.startsWith(';') ? t.typesByName.get(name) : undefined;
        if (ty) refs.push({ line: lineNo, startCol: col, endCol: col + name.length, name, kind: 'type', targets: [ty.decl.id], confidence: 'exact' });
        continue;
      }
      if (after.startsWith('(')) {
        const openCol = m.indexOf('(', col + name.length);
        const arity = arityOf(f.masked, li, openCol);
        if (/\bnew$/.test(before)) {
          const ty = t.typesByName.get(name);
          if (!ty) continue;
          const ctors = (t.members.get(ty.decl.id) ?? []).filter((d) => d.kind === 'constructor');
          const pick = ctors.filter((d) => declArity(d) === arity);
          const targets = (pick.length > 0 ? pick : ctors).map((d) => d.id);
          refs.push({ line: lineNo, startCol: col, endCol: col + name.length, name, kind: 'constructor', targets: targets.length > 0 ? targets : [ty.decl.id], confidence: 'exact' });
          continue;
        }
        let targets: SymbolDecl[] = [];
        let confidence: SymbolRef['confidence'] = 'exact';
        if (before.endsWith('.')) {
          const recv = /([A-Za-z_$][\w$]*)$/.exec(before.slice(0, -1).trimEnd())?.[1];
          const recvType = recv === 'this' ? typeAtLine(lineNo)?.name : recv && /^[A-Z]/.test(recv) && t.typesByName.has(recv) ? recv : recv ? f.vars.get(recv) : undefined;
          const ty = recvType ? t.typesByName.get(recvType) : undefined;
          if (ty) {
            targets = methodsNamed(t, ty.decl.id, name, arity);
          } else if (!before.endsWith(').')) {
            // Alıcı tipi çözülemedi: yalnız ad eşleşmesi (az sayıda adayda).
            const all = [...t.byId.values()].map((x) => x.decl).filter((d) => d.kind === 'method' && d.name === name && declArity(d) === arity);
            if (all.length > 0 && all.length <= 4) {
              targets = all;
              confidence = 'name-only';
            }
          }
        } else if (!before.endsWith('::')) {
          const own = typeAtLine(lineNo);
          targets = own ? methodsNamed(t, own.id, name, arity) : [];
          const virt = targets.filter((d) => t.abstractIds.has(d.id)).flatMap((d) => overriders(t, d));
          if (virt.length > 0) {
            targets = [...targets, ...virt];
            confidence = 'likely';
          }
        }
        if (targets.length > 0) refs.push({ line: lineNo, startCol: col, endCol: col + name.length, name, kind: 'call', targets: targets.map((d) => d.id), confidence });
        continue;
      }
      if (before.endsWith('::')) {
        const recv = /([A-Za-z_$][\w$]*)$/.exec(before.slice(0, -2).trimEnd())?.[1];
        const ty = recv ? t.typesByName.get(recv) : undefined;
        const targets = ty ? (t.members.get(ty.decl.id) ?? []).filter((d) => d.name === name).map((d) => d.id) : [];
        if (targets.length > 0) refs.push({ line: lineNo, startCol: col, endCol: col + name.length, name, kind: 'methodRef', targets, confidence: 'exact' });
        continue;
      }
      if (/^[A-Z]/.test(name) && !before.endsWith('.')) {
        const ty = t.typesByName.get(name);
        if (ty) refs.push({ line: lineNo, startCol: col, endCol: col + name.length, name, kind: 'type', targets: [ty.decl.id], confidence: 'exact' });
      }
    }
  });
  return refs;
}

const inDiffPaths = (): Set<string> => new Set(sampleReview.files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])));

/** Mock `/outline`. Dosya içeriği yoksa null (404). Java dışı dosyada boş decls/refs. */
export function mockOutline(path: string, side: 'old' | 'new'): FileOutline | null {
  const content = sampleFiles[path]?.[side];
  if (content === null || content === undefined) return null;
  const inDiff = inDiffPaths().has(path);
  if (!path.endsWith('.java')) return { path, side, inDiff, decls: [], refs: [] };
  const t = getTable();
  const f = t.files.get(fileKey(path, side));
  if (!f) return { path, side, inDiff, decls: [], refs: [] };
  return { path, side, inDiff, packageName: f.packageName, decls: f.decls, refs: refsFor(t, f) };
}

/** Mock `/locate`. Bulunamazsa null (404). */
export function mockLocate(id: string): SymbolLocation | null {
  const t = getTable();
  const hit = t.byId.get(id);
  if (!hit) return null;
  const { decl, file } = hit;
  const range: Range = decl.range;
  const isType = !decl.ownerTypeId || decl.kind === 'class' || decl.kind === 'interface' || decl.kind === 'enum' || decl.kind === 'record' || decl.kind === 'annotation';
  return {
    id,
    kind: decl.kind,
    name: decl.name,
    signature: decl.signature,
    path: file.path,
    side: file.side,
    range,
    inDiff: inDiffPaths().has(file.path),
    typeId: isType ? decl.id : decl.ownerTypeId,
  };
}

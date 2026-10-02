/**
 * Çağrı argümanlarının statik tip çıkarımı (yalnızca kesin olanlar: literal, yerel değişken/parametre, alan, `new X(..)`, cast)
 * ve parametre tipiyle uyumluluk kontrolü. Emin olunamayan her durumda 'unknown' döner; çağıran taraf sessiz kalır.
 */
import { eraseTypeForId, typeParamNames } from '../java/names.js';
import type { JavaFileModel, JavaMember, JavaType, RepoIndexApi } from '../java/model.js';

export type Compat = 'ok' | 'mismatch' | 'unknown';

const PRIMITIVES = new Set(['byte', 'short', 'char', 'int', 'long', 'float', 'double', 'boolean']);
const BOX: Record<string, string> = {
  Byte: 'byte',
  Short: 'short',
  Character: 'char',
  Integer: 'int',
  Long: 'long',
  Float: 'float',
  Double: 'double',
  Boolean: 'boolean',
};
const WIDENING: Record<string, readonly string[]> = {
  byte: ['short', 'int', 'long', 'float', 'double'],
  short: ['int', 'long', 'float', 'double'],
  char: ['int', 'long', 'float', 'double'],
  int: ['long', 'float', 'double'],
  long: ['float', 'double'],
  float: ['double'],
  double: [],
  boolean: [],
};

/** Değer tipleri: ilkel, kutulu ve String. Bunlar arasındaki uyum kesin olarak bilinir. */
function isValueType(t: string): boolean {
  return PRIMITIVES.has(t) || t in BOX || t === 'String';
}

function valueCompatible(arg: string, param: string): boolean {
  if (arg === param) return true;
  if (arg === 'String' || param === 'String') return false;
  const argPrim = PRIMITIVES.has(arg) ? arg : BOX[arg];
  if (PRIMITIVES.has(param)) {
    // ilkel ← ilkel (genişletme) veya kutulu (unboxing + genişletme)
    return argPrim === param || (WIDENING[argPrim] ?? []).includes(param);
  }
  // kutulu param: yalnızca aynı ilkelin kutulanması
  return PRIMITIVES.has(arg) && BOX[param] === arg;
}

const INT_RE = /^-?(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*)$/;
const LONG_RE = /^-?(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*)[lL]$/;
const FLOAT_RE = /^-?(?:\d[\d_]*\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fF]$/;
const DOUBLE_RE = /^-?(?:(?:\d[\d_]*\.\d*|\.\d+)(?:[eE][+-]?\d+)?[dD]?|\d[\d_]*(?:[eE][+-]?\d+)[dD]?|\d[\d_]*[dD])$/;
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const NEW_RE = /^new\s+([\w$.]+)\s*(?:<[^()]*>)?\s*\(/;
const CAST_RE = /^\(\s*([\w$.]+(?:\s*<[^()]*>)?(?:\s*\[\s*\])*)\s*\)\s*[\w$"'(]/;

/**
 * Argüman ifadesinin tipi (sembol id biçiminde silinmiş basit ad: 'int', 'String', 'OrderId', 'List[]') veya undefined.
 * `caller` çağrının bulunduğu üye, `callerType` sahibi (alan tipleri için).
 */
export function inferArgType(text: string, caller: JavaMember | undefined, callerType: JavaType | undefined): string | undefined {
  const t = text.trim();
  if (!t || t.endsWith('…')) return undefined;
  if (t.startsWith('"')) return 'String';
  if (/^'(?:[^'\\]|\\.[^']*)'$/.test(t)) return 'char';
  if (t === 'true' || t === 'false') return 'boolean';
  if (LONG_RE.test(t)) return 'long';
  if (INT_RE.test(t)) return 'int';
  if (FLOAT_RE.test(t)) return 'float';
  if (DOUBLE_RE.test(t)) return 'double';
  if (IDENT_RE.test(t)) {
    const declared = caller?.localTypes[t] ?? callerType?.fieldTypes[t];
    return declared ? eraseTypeForId(declared) : undefined;
  }
  const thisField = /^this\.([A-Za-z_$][\w$]*)$/.exec(t);
  if (thisField) {
    const declared = callerType?.fieldTypes[thisField[1]];
    return declared ? eraseTypeForId(declared) : undefined;
  }
  const created = NEW_RE.exec(t);
  if (created && !t.includes('{')) return eraseTypeForId(created[1]);
  const cast = CAST_RE.exec(t);
  if (cast) return eraseTypeForId(cast[1]);
  return undefined;
}

export interface TypeCtx {
  file?: JavaFileModel;
  type?: JavaType;
}

function supersTransitive(index: Pick<RepoIndexApi, 'superTypesOf'>, fqn: string): Set<string> {
  const seen = new Set<string>();
  const queue = [fqn];
  while (queue.length) {
    const cur = queue.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...index.superTypesOf(cur));
  }
  return seen;
}

/**
 * Argüman tipi `arg` (argCtx bağlamında yazılmış) ile parametre tipi `param` (paramCtx bağlamında) uyumlu mu.
 * `typeVars`: metot ve sahip tipin tip parametreleri (bunlara her şey uyar).
 */
export function argCompatibility(
  index: Pick<RepoIndexApi, 'resolveTypeName' | 'getType' | 'superTypesOf'>,
  arg: string,
  argCtx: TypeCtx,
  rawParam: string,
  paramCtx: TypeCtx,
  typeVars: ReadonlySet<string>,
): Compat {
  let param = eraseTypeForId(rawParam);
  if (param.endsWith('...')) {
    const base = param.slice(0, -3);
    param = arg.endsWith('[]') ? `${base}[]` : base;
  }
  if (typeVars.has(param.replace(/(\[\])+$/, '')) || param === 'Object') return 'ok';
  if (arg === param) return 'ok';
  if (isValueType(arg) && isValueType(param)) return valueCompatible(arg, param) ? 'ok' : 'mismatch';
  if (arg.endsWith('[]') || param.endsWith('[]')) return 'unknown';
  const argFqn = argCtx.file ? index.resolveTypeName(arg, argCtx.file, argCtx.type) : undefined;
  const paramFqn = paramCtx.file ? index.resolveTypeName(param, paramCtx.file, paramCtx.type) : undefined;
  const argInRepo = !!argFqn && !!index.getType(argFqn);
  const paramInRepo = !!paramFqn && !!index.getType(paramFqn);
  if (isValueType(arg) && paramInRepo) return 'mismatch';
  if (isValueType(param) && argInRepo) return 'mismatch';
  if (argInRepo && paramInRepo) return supersTransitive(index, argFqn as string).has(paramFqn as string) ? 'ok' : 'mismatch';
  return 'unknown';
}

/** Metot + sahip tipin (ve dış tiplerin bilinen) tip parametre adları. */
export function typeVarsOf(member: JavaMember, owner: JavaType | undefined): Set<string> {
  return new Set([...typeParamNames(member.typeParams), ...typeParamNames(owner?.typeParams)]);
}

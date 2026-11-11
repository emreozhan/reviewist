/**
 * Testler için JavaMember / JavaType / JavaFileModel / MemberDiff / TypeDiff kurucuları.
 * Ayrıştırıcı ve semantik diff olmadan analiz fonksiyonlarını elle kurulmuş modellerle test etmeye yarar.
 */
import type { ChangeFlag, ChangeStatus, MemberChange, TypeChange } from '../../shared/types.js';
import type { CodeFeatures, JavaFileModel, JavaImport, JavaMember, JavaType, MemberDiff, TypeDiff } from '../java/model.js';
import { emptyRisk, packageOf, simpleTypeName } from '../analysis/util.js';

export function zeroFeatures(over: Partial<CodeFeatures> = {}): CodeFeatures {
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
    ...over,
  };
}

export type MemberInit = Partial<Omit<JavaMember, 'features'>> & {
  ownerFqn: string;
  name: string;
  features?: Partial<CodeFeatures>;
};

export function jMember(init: MemberInit): JavaMember {
  const kind = init.kind ?? 'method';
  const params = init.params ?? [];
  const visibility = init.visibility ?? 'public';
  const modifiers = init.modifiers ?? (visibility === 'package' ? [] : [visibility]);
  const id =
    init.id ??
    (kind === 'method' || kind === 'constructor'
      ? `${init.ownerFqn}#${init.name}(${params.map((p) => p.type.replace(/<.*>/, '')).join(',')})`
      : `${init.ownerFqn}#${init.name}`);
  const sig =
    init.signature ??
    (kind === 'field'
      ? `${modifiers.join(' ')} ${init.fieldType ?? 'Object'} ${init.name}`.trim()
      : `${modifiers.join(' ')} ${init.returnType ?? 'void'} ${init.name}(${params.map((p) => `${p.type} ${p.name}`).join(', ')})`.trim());
  const text = init.text ?? `${sig} {}`;
  return {
    kind,
    name: init.name,
    id,
    ownerFqn: init.ownerFqn,
    params,
    returnType: init.returnType ?? (kind === 'method' ? 'void' : undefined),
    fieldType: init.fieldType,
    throws: init.throws ?? [],
    modifiers,
    annotations: init.annotations ?? [],
    typeParams: init.typeParams,
    visibility,
    range: init.range ?? { startLine: 1, endLine: 1 },
    javadoc: init.javadoc,
    javadocRange: init.javadocRange,
    signature: sig,
    text,
    normalizedBody: init.normalizedBody ?? '',
    normalizedText: init.normalizedText ?? text.replace(/\s+/g, ' '),
    callSites: init.callSites ?? [],
    localTypes: init.localTypes ?? {},
    complexity: init.complexity ?? 1,
    features: zeroFeatures(init.features),
    initializerText: init.initializerText,
  };
}

export type TypeInit = Partial<JavaType> & { fqn: string };

export function jType(init: TypeInit): JavaType {
  const visibility = init.visibility ?? 'public';
  return {
    fqn: init.fqn,
    name: init.name ?? simpleTypeName(init.fqn),
    kind: init.kind ?? 'class',
    modifiers: init.modifiers ?? (visibility === 'package' ? [] : [visibility]),
    annotations: init.annotations ?? [],
    visibility,
    typeParams: init.typeParams,
    superclass: init.superclass,
    interfaces: init.interfaces ?? [],
    range: init.range ?? { startLine: 1, endLine: 100 },
    javadoc: init.javadoc,
    members: init.members ?? [],
    outerFqn: init.outerFqn,
    nestedTypeFqns: init.nestedTypeFqns ?? [],
    fieldTypes: init.fieldTypes ?? {},
    normalizedText: init.normalizedText ?? '',
  };
}

export function jFile(path: string, types: JavaType[], init: { packageName?: string; imports?: (string | JavaImport)[]; normalizedCode?: string; hasErrors?: boolean } = {}): JavaFileModel {
  const packageName = init.packageName ?? (types[0] ? packageOf(types[0].fqn) : '');
  return {
    path,
    packageName,
    imports: (init.imports ?? []).map((imp, i) =>
      typeof imp === 'string' ? { name: imp.replace(/\.\*$/, ''), static: false, wildcard: imp.endsWith('.*'), line: i + 3 } : imp,
    ),
    types,
    hasErrors: init.hasErrors ?? false,
    errorLines: [],
    lineCount: 100,
    normalizedCode: init.normalizedCode ?? types.map((t) => t.normalizedText).join('\n'),
  };
}

export interface MemberDiffInit {
  status: ChangeStatus;
  oldMember?: JavaMember;
  newMember?: JavaMember;
  flags?: ChangeFlag[];
  details?: string[];
  linesAdded?: number;
  linesRemoved?: number;
}

export function memberDiff(init: MemberDiffInit): MemberDiff {
  const m = init.newMember ?? init.oldMember;
  if (!m) throw new Error('memberDiff: en az bir üye gerekli');
  const change: MemberChange = {
    id: m.id,
    kind: m.kind,
    name: m.name,
    ownerTypeId: m.ownerFqn,
    signature: m.signature,
    visibility: m.visibility,
    status: init.status,
    flags: init.flags ?? [],
    details: init.details ?? [],
    linesAdded: init.linesAdded ?? 0,
    linesRemoved: init.linesRemoved ?? 0,
    overrides: [],
    overriddenBy: [],
    callers: [],
    callees: [],
    risk: emptyRisk(),
  };
  if (init.oldMember && init.newMember) {
    if (init.oldMember.id !== init.newMember.id) change.oldId = init.oldMember.id;
    if (init.oldMember.name !== init.newMember.name) change.oldName = init.oldMember.name;
    if (init.oldMember.signature !== init.newMember.signature) change.oldSignature = init.oldMember.signature;
    change.oldRange = init.oldMember.range;
  }
  if (init.newMember) change.newRange = init.newMember.range;
  else if (init.oldMember) change.oldRange = init.oldMember.range;
  return { change, oldMember: init.oldMember, newMember: init.newMember };
}

export interface TypeDiffInit {
  status: ChangeStatus;
  oldType?: JavaType;
  newType?: JavaType;
  members?: MemberDiff[];
  file: string;
  oldFile?: JavaFileModel;
  newFile?: JavaFileModel;
  flags?: ChangeFlag[];
}

export function typeDiff(init: TypeDiffInit): TypeDiff {
  const t = init.newType ?? init.oldType;
  if (!t) throw new Error('typeDiff: en az bir tip gerekli');
  const members = init.members ?? [];
  const change: TypeChange = {
    id: t.fqn,
    name: t.name,
    kind: t.kind,
    file: init.file,
    status: init.status,
    flags: init.flags ?? [],
    details: [],
    visibility: t.visibility,
    annotations: t.annotations,
    superTypes: [...(t.superclass ? [t.superclass] : []), ...t.interfaces],
    subTypes: [],
    members: members.map((m) => m.change),
    layer: 'other',
    risk: emptyRisk(),
  };
  if (init.oldType && init.newType && init.oldType.fqn !== init.newType.fqn) change.oldId = init.oldType.fqn;
  if (init.oldType) change.oldRange = init.oldType.range;
  if (init.newType) change.newRange = init.newType.range;
  return { change, oldType: init.oldType, newType: init.newType, members, oldFile: init.oldFile, newFile: init.newFile };
}

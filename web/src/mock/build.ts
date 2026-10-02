import type {
  CallRef,
  ChangeFlag,
  ChangeStatus,
  FileChange,
  FileStatus,
  Layer,
  MemberChange,
  MemberKind,
  Range,
  RiskInfo,
  RiskLevel,
  TypeChange,
  TypeKind,
} from '../../../src/shared/types';
import { buildHunks, countChanges } from '../lib/hunks';
import { sampleFiles } from './sampleFiles';

/** Mock veriyi içerikten tutarlı biçimde kurmak için yardımcılar (satır no ve aralıklar elle yazılmaz). */

function contentOf(path: string, side: 'old' | 'new'): string {
  const c = sampleFiles[path]?.[side];
  if (c === null || c === undefined) throw new Error(`Mock içerik yok: ${side}:${path}`);
  return c;
}

export function lineOf(path: string, side: 'old' | 'new', needle: string): number {
  const lines = contentOf(path, side).split('\n');
  const idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`Mock: "${needle}" bulunamadı (${side}:${path})`);
  return idx + 1;
}

/** İğneyi içeren satırdan başlayıp süslü parantez dengesine göre bildirimin sonunu bulur; üstteki anotasyonları dahil eder. */
export function rangeOf(path: string, side: 'old' | 'new', needle: string): Range {
  const lines = contentOf(path, side).split('\n');
  const start = lineOf(path, side, needle) - 1;
  let first = start;
  while (first > 0 && (lines[first - 1] ?? '').trim().startsWith('@')) first--;
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    const text = lines[i] ?? '';
    for (const ch of text) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') {
        depth--;
      }
    }
    if (opened && depth <= 0) return { startLine: first + 1, endLine: i + 1 };
    if (!opened && text.trimEnd().endsWith(';')) return { startLine: first + 1, endLine: i + 1 };
  }
  return { startLine: first + 1, endLine: lines.length };
}

export function levelFor(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function risk(...reasons: Array<[code: string, message: string, weight: number]>): RiskInfo {
  const score = Math.min(100, reasons.reduce((s, r) => s + r[2], 0));
  return { score, level: levelFor(score), reasons: reasons.map(([code, message, weight]) => ({ code, message, weight })) };
}

export const NO_RISK: RiskInfo = { score: 0, level: 'low', reasons: [] };

function languageOf(path: string): FileChange['language'] {
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.xml')) return 'xml';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  if (path.endsWith('.properties')) return 'properties';
  if (path.endsWith('.sql')) return 'sql';
  return 'other';
}

export interface FileSpec {
  path: string;
  oldPath?: string;
  status: FileStatus;
  layer: Layer;
  packageName?: string;
  typeIds?: string[];
  isTest?: boolean;
  cosmeticOnly?: boolean;
  relatedTestFiles?: string[];
  risk?: RiskInfo;
}

export function file(spec: FileSpec): FileChange {
  const oldText = spec.status === 'added' ? '' : contentOf(spec.oldPath ?? spec.path, 'old');
  const newText = spec.status === 'deleted' ? '' : contentOf(spec.path, 'new');
  const hunks = buildHunks(oldText, newText);
  const { additions, deletions } = countChanges(hunks);
  return {
    id: spec.path,
    path: spec.path,
    oldPath: spec.oldPath,
    status: spec.status,
    language: languageOf(spec.path),
    binary: false,
    additions,
    deletions,
    hunks,
    packageName: spec.packageName,
    layer: spec.layer,
    isTest: spec.isTest ?? false,
    cosmeticOnly: spec.cosmeticOnly ?? false,
    typeIds: spec.typeIds ?? [],
    relatedTestFiles: spec.relatedTestFiles ?? [],
    risk: spec.risk ?? NO_RISK,
    reviewOrder: 0,
  };
}

export interface MemberSpec {
  name: string;
  params?: string; // id içindeki parametre tipleri: 'Money,String'
  kind?: MemberKind;
  signature: string;
  oldSignature?: string;
  status: ChangeStatus;
  visibility?: MemberChange['visibility'];
  flags?: ChangeFlag[];
  details?: string[];
  /** Eski/yeni aralığı bulmak için dosyada aranacak metin. */
  oldNeedle?: string;
  newNeedle?: string;
  oldId?: string;
  oldName?: string;
  overrides?: string[];
  overriddenBy?: string[];
  callers?: CallRef[];
  callees?: string[];
  risk?: RiskInfo;
  groupId?: string;
}

export function memberId(typeId: string, name: string, params?: string): string {
  return params === undefined ? `${typeId}#${name}` : `${typeId}#${name}(${params})`;
}

export interface TypeSpec {
  id: string;
  kind: TypeKind;
  file: string;
  oldFile?: string;
  status: ChangeStatus;
  layer: Layer;
  visibility?: TypeChange['visibility'];
  annotations?: string[];
  superTypes?: string[];
  oldSuperTypes?: string[];
  subTypes?: string[];
  flags?: ChangeFlag[];
  details?: string[];
  oldNeedle?: string;
  newNeedle?: string;
  risk?: RiskInfo;
  members: MemberSpec[];
}

export function type(spec: TypeSpec): TypeChange {
  const name = spec.id.slice(spec.id.lastIndexOf('.') + 1);
  const oldFile = spec.oldFile ?? spec.file;
  const members = spec.members.map<MemberChange>((m) => ({
    id: memberId(spec.id, m.name, m.kind === 'field' ? undefined : (m.params ?? '')),
    oldId: m.oldId,
    kind: m.kind ?? 'method',
    name: m.name,
    oldName: m.oldName,
    ownerTypeId: spec.id,
    signature: m.signature,
    oldSignature: m.oldSignature,
    visibility: m.visibility ?? 'public',
    status: m.status,
    flags: m.flags ?? [],
    details: m.details ?? [],
    oldRange: m.oldNeedle ? rangeOf(oldFile, 'old', m.oldNeedle) : undefined,
    newRange: m.newNeedle ? rangeOf(spec.file, 'new', m.newNeedle) : undefined,
    linesAdded: 0,
    linesRemoved: 0,
    overrides: m.overrides ?? [],
    overriddenBy: m.overriddenBy ?? [],
    callers: m.callers ?? [],
    callees: m.callees ?? [],
    risk: m.risk ?? NO_RISK,
    groupId: m.groupId,
  }));
  return {
    id: spec.id,
    name,
    kind: spec.kind,
    file: spec.file,
    status: spec.status,
    flags: spec.flags ?? [],
    details: spec.details ?? [],
    visibility: spec.visibility ?? 'public',
    annotations: spec.annotations ?? [],
    superTypes: spec.superTypes ?? [],
    oldSuperTypes: spec.oldSuperTypes,
    subTypes: spec.subTypes ?? [],
    oldRange: spec.oldNeedle ? rangeOf(oldFile, 'old', spec.oldNeedle) : undefined,
    newRange: spec.newNeedle ? rangeOf(spec.file, 'new', spec.newNeedle) : undefined,
    members,
    layer: spec.layer,
    risk: spec.risk ?? NO_RISK,
  };
}

export function call(fromId: string, path: string, needle: string, inChangedCode: boolean, confidence: CallRef['confidence'] = 'exact'): CallRef {
  return { fromId, file: path, line: lineOf(path, 'new', needle), inChangedCode, confidence };
}

/** Üyelerin eklenen/silinen satır sayılarını dosya hunk'larından hesaplar. */
export function fillLineCounts(types: TypeChange[], files: FileChange[]): void {
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const t of types) {
    const f = byPath.get(t.file);
    if (!f) continue;
    for (const m of t.members) {
      for (const h of f.hunks) {
        for (const l of h.lines) {
          if (l.type === 'add' && m.newRange && l.newNo !== undefined && l.newNo >= m.newRange.startLine && l.newNo <= m.newRange.endLine) m.linesAdded++;
          if (l.type === 'del' && m.oldRange && l.oldNo !== undefined && l.oldNo >= m.oldRange.startLine && l.oldNo <= m.oldRange.endLine) m.linesRemoved++;
        }
      }
    }
  }
}

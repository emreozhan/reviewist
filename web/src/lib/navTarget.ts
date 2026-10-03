import type { SymbolLocation } from '../../../src/shared/types';
import { locateSymbol } from './locate';
import type { ReviewIndex } from './reviewIndex';
import { baseName, symbolLabel, topLevelFqn } from './reviewIndex';
import { parseSymbolId, simpleTypeName } from './symbolId';
import type { HistoryEntry, OpenSpec, TabSide } from './tabs';

/** Sekmede açılacak hedef: dosya + (varsa) odak sembolü ve satırı. */
export interface NavTarget {
  path: string;
  side: TabSide;
  inDiff: boolean;
  symbolId?: string;
  line?: number;
  endLine?: number;
  typeId?: string;
  /** Konum paket adından tahmin edildi (sunucu vermedi). */
  guessed?: boolean;
  /** Satır bir çağrı yeri (çağıran listesi): diff görünümünde o satıra gidilir. */
  callSite?: boolean;
}

/** Sekme başlığı: dosyanın (üst düzey) sınıf adı; bilinmiyorsa uzantısız dosya adı. */
export function tabLabelFor(index: ReviewIndex, path: string, typeId?: string): string {
  const file = index.fileById.get(path);
  const first = file?.typeIds[0] ? index.typeById.get(file.typeIds[0]) : undefined;
  if (first) return first.name;
  if (typeId) return simpleTypeName(topLevelFqn(typeId));
  return baseName(path).replace(/\.java$/, '');
}

/** Kırıntı izi metni: 'AbstractNotifier.notify()'; sembolsüzse sekme başlığı. */
export function crumbFor(index: ReviewIndex, symbolId: string | undefined, label: string): string {
  return symbolId ? symbolLabel(index, symbolId) : label;
}

export function toOpenSpec(index: ReviewIndex, t: NavTarget): OpenSpec {
  const label = tabLabelFor(index, t.path, t.typeId ?? (t.symbolId ? parseSymbolId(t.symbolId).typeId : undefined));
  return {
    path: t.path,
    side: t.side,
    inDiff: t.inDiff,
    label,
    typeId: t.typeId,
    symbolId: t.symbolId,
    crumb: crumbFor(index, t.symbolId, label),
    line: t.line,
    endLine: t.endLine,
  };
}

export function targetFromEntry(e: HistoryEntry): NavTarget {
  return { path: e.path, side: e.side, inDiff: e.inDiff, symbolId: e.symbolId, line: e.line, endLine: e.endLine, typeId: e.typeId };
}

/**
 * ReviewModel'den (eşzamanlı) konum: diff içi sembolün dosyası; diff dışında graf düğümünün aralığı; yoksa tahmin.
 * `hint`: çağıran listesindeki gibi bilinen dosya/satır (çağrı yeri).
 */
export function resolveLocal(index: ReviewIndex, symbolId: string, hint?: { file?: string; line?: number; side?: TabSide; callSite?: boolean }): NavTarget | null {
  const typeId = index.memberById.get(symbolId)?.ownerTypeId ?? (index.typeById.has(symbolId) ? symbolId : index.nodeById.get(symbolId)?.typeId);
  if (hint?.file) {
    const inDiff = index.fileById.has(hint.file);
    return { path: hint.file, side: hint.side ?? 'new', inDiff, symbolId, line: hint.line, typeId, callSite: hint.callSite };
  }
  const diffFile = index.symbolFile.get(symbolId);
  if (diffFile) {
    const m = index.memberById.get(symbolId);
    const t = index.typeById.get(symbolId);
    const range = m?.newRange ?? t?.newRange;
    return { path: diffFile, side: 'new', inDiff: true, symbolId, line: range?.startLine, endLine: range?.endLine, typeId };
  }
  const loc = locateSymbol(index, symbolId);
  if (!loc.file) return null;
  const node = index.nodeById.get(symbolId);
  const inDiff = loc.side === 'new' && index.fileById.has(loc.file);
  return {
    path: loc.file,
    side: loc.side,
    inDiff,
    symbolId,
    line: loc.line,
    endLine: node?.range?.endLine,
    typeId,
    guessed: loc.guessed,
  };
}

/** Sunucunun `/locate` sonucunu hedefe çevirir. */
export function fromLocation(index: ReviewIndex, loc: SymbolLocation): NavTarget {
  const inDiff = loc.side === 'new' && (loc.inDiff || index.fileById.has(loc.path));
  return { path: loc.path, side: loc.side, inDiff, symbolId: loc.id, line: loc.range.startLine, endLine: loc.range.endLine, typeId: loc.typeId };
}

/** Yerel çözüm yetersizse (tahmin, satırsız diff dışı ya da hiç yok) sunucuya sorulmalı mı. */
export function needsLocate(local: NavTarget | null): boolean {
  return !local || !!local.guessed || (!local.inDiff && local.line === undefined);
}

import type { CallRef, ImpactNodeStatus } from '../../../src/shared/types';
import type { ReviewIndex } from './reviewIndex';
import { symbolLabel, symbolLocation } from './reviewIndex';

export interface PropItem {
  key: string;
  id: string;
  label: string;
  file?: string;
  line?: number;
  /** Hedef dosya bu diff'in içinde mi (tıklanınca oraya gidilir). */
  inDiff: boolean;
  /** Çağrı satırı bu diff'te değişti mi (yalnız çağıranlar için). */
  inChangedCode?: boolean;
  confidence?: CallRef['confidence'];
  status?: ImpactNodeStatus;
  /** Satır bilinmiyorsa önizlemede aranacak bildirim kalıbı. */
  search?: string;
}

export type PropSectionId = 'overrides' | 'overriddenBy' | 'inheritors' | 'superTypes' | 'subTypes' | 'callersIn' | 'callersOut' | 'callees';

export interface PropSection {
  id: PropSectionId;
  title: string;
  glyph: string;
  items: PropItem[];
  /** Diff dışı, değişmeyen ama etkilenen kod. */
  outside: boolean;
}

function simpleName(id: string): string {
  const hash = id.indexOf('#');
  if (hash >= 0) {
    const m = id.slice(hash + 1);
    const p = m.indexOf('(');
    return p >= 0 ? m.slice(0, p) : m;
  }
  return id.slice(id.lastIndexOf('.') + 1);
}

export function searchHint(id: string): string {
  return id.includes('#') ? `${simpleName(id)}(` : simpleName(id);
}

function symbolItem(index: ReviewIndex, id: string, keyPrefix: string): PropItem {
  const loc = symbolLocation(index, id);
  const m = index.memberById.get(id);
  const t = index.typeById.get(id);
  const range = m?.newRange ?? m?.oldRange ?? t?.newRange ?? t?.oldRange;
  return {
    key: `${keyPrefix}:${id}`,
    id,
    label: symbolLabel(index, id),
    file: loc.file,
    line: range?.startLine,
    inDiff: loc.inDiff,
    status: m?.status ?? t?.status ?? index.nodeById.get(id)?.status,
    search: searchHint(id),
  };
}

function callItem(index: ReviewIndex, c: CallRef, keyPrefix: string): PropItem {
  return {
    key: `${keyPrefix}:${c.fromId}:${c.file}:${c.line}`,
    id: c.fromId,
    label: symbolLabel(index, c.fromId),
    file: c.file,
    line: c.line,
    inDiff: index.fileById.has(c.file),
    inChangedCode: c.inChangedCode,
    confidence: c.confidence,
    status: index.memberById.get(c.fromId)?.status ?? index.nodeById.get(c.fromId)?.status,
  };
}

function section(id: PropSectionId, title: string, glyph: string, items: PropItem[], outside = false): PropSection | null {
  return items.length > 0 ? { id, title, glyph, items, outside } : null;
}

/** "Bu değişiklik nereye gidiyor?" bölümleri: üst/alt hiyerarşi, çağıranlar (diff içi/dışı), çağrılanlar. */
export function propagationFor(index: ReviewIndex, symbolId: string): PropSection[] {
  const m = index.memberById.get(symbolId);
  const out: (PropSection | null)[] = [];
  if (m) {
    const owner = index.typeById.get(m.ownerTypeId);
    out.push(section('overrides', 'Override ettiği üst metot', '⇡', m.overrides.map((id) => symbolItem(index, id, 'ov'))));
    out.push(section('overriddenBy', 'Bunu override eden alt sınıf metotları', '⇣', m.overriddenBy.map((id) => symbolItem(index, id, 'ovby'))));
    // Alt tipte kendi override'ı olanlar zaten "override edenler" bölümünde; burada yalnız davranışı olduğu gibi devralanlar.
    const overridingOwners = new Set(m.overriddenBy.map((id) => index.memberById.get(id)?.ownerTypeId ?? id.split('#')[0]));
    const inherits = m.kind === 'method' && m.status !== 'unchanged' && m.visibility !== 'private' && owner
      ? owner.subTypes.filter((t) => !overridingOwners.has(t))
      : [];
    out.push(section('inheritors', 'Bu davranışı devralan alt tipler', '⇣', inherits.map((id) => symbolItem(index, id, 'inh'))));
    const callers = m.callers.map((c) => callItem(index, c, 'call'));
    out.push(section('callersIn', 'Çağıranlar — diff içinde', '↗', callers.filter((c) => c.inDiff)));
    out.push(section('callersOut', 'Etkilenen ama değişmeyen kod — diff dışı çağıranlar', '↗', callers.filter((c) => !c.inDiff), true));
    out.push(section('callees', 'Çağırdıkları', '↘', m.callees.map((id) => symbolItem(index, id, 'callee'))));
    return out.filter((s): s is PropSection => s !== null);
  }
  const t = index.typeById.get(symbolId);
  if (t) {
    out.push(section('superTypes', 'Üst tipler', '⇡', t.superTypes.map((id) => symbolItem(index, id, 'sup'))));
    const subs = t.subTypes.map((id) => symbolItem(index, id, 'sub'));
    out.push(section('subTypes', 'Alt tipler / implementasyonlar', '⇣', subs));
    const calls = t.members.flatMap((mm) => mm.callers.map((c) => callItem(index, c, `tc:${mm.id}`)));
    out.push(section('callersIn', 'Üyelerin çağıranları — diff içinde', '↗', calls.filter((c) => c.inDiff)));
    out.push(section('callersOut', 'Etkilenen ama değişmeyen kod — diff dışı çağıranlar', '↗', calls.filter((c) => !c.inDiff), true));
  }
  return out.filter((s): s is PropSection => s !== null);
}

import type { CallRef, ImpactNodeStatus } from '../../../src/shared/types';
import type { ReviewIndex } from './reviewIndex';
import { locateSymbol } from './locate';
import { symbolLabel } from './reviewIndex';
import { ownerTypeId } from './symbolId';

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
  /** Önizlemede okunacak taraf (silinmiş sembol için 'old'). */
  side?: 'old' | 'new';
  /** Dosya yolu paket adından tahmin edildi (sunucu konum vermedi). */
  guessed?: boolean;
}

export type PropSectionId = 'overrides' | 'overriddenBy' | 'inheritors' | 'superTypes' | 'subTypes' | 'callersIn' | 'callersOut' | 'callees';

export interface PropSection {
  id: PropSectionId;
  title: string;
  glyph: string;
  /** Gösterilen öğeler (çağıranlarda: exact + likely). */
  items: PropItem[];
  /** Varsayılan gizli öğeler: alıcısı çözülemeyen 'name-only' çağrı eşleşmeleri. */
  unverified: PropItem[];
  /** Diff dışı, değişmeyen ama etkilenen kod. */
  outside: boolean;
}

function symbolItem(index: ReviewIndex, id: string, keyPrefix: string): PropItem {
  const loc = locateSymbol(index, id);
  const m = index.memberById.get(id);
  const t = index.typeById.get(id);
  return {
    key: `${keyPrefix}:${id}`,
    id,
    label: symbolLabel(index, id),
    file: loc.file,
    line: loc.line,
    side: loc.side,
    guessed: loc.guessed,
    inDiff: loc.inDiff,
    status: m?.status ?? t?.status ?? index.nodeById.get(id)?.status,
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

function section(id: PropSectionId, title: string, glyph: string, all: PropItem[], outside = false): PropSection | null {
  if (all.length === 0) return null;
  const items: PropItem[] = [];
  const unverified: PropItem[] = [];
  for (const it of all) (it.confidence === 'name-only' ? unverified : items).push(it);
  // Güveni yüksek olanlar önce: exact, sonra likely.
  items.sort((a, b) => CONF_RANK[a.confidence ?? 'exact'] - CONF_RANK[b.confidence ?? 'exact']);
  return { id, title, glyph, items, unverified, outside };
}

const CONF_RANK: Record<CallRef['confidence'], number> = { exact: 0, likely: 1, 'name-only': 2 };

/**
 * Çağıran sayıları güvene göre: rozet ve özetlerde 'name-only' ayrı sayılır.
 * `inDiff` verilirse "diff dışı" = çağıran dosya bu diff'te değil (denetçideki bölümlerle aynı ölçüt);
 * verilmezse çağrı satırının değişmemiş olması.
 */
export function callerCounts(
  callers: readonly CallRef[],
  inDiff?: (file: string) => boolean,
): { verified: number; likely: number; unverified: number; outside: number } {
  let likely = 0;
  let unverified = 0;
  let outside = 0;
  for (const c of callers) {
    if (c.confidence === 'name-only') {
      unverified++;
      continue;
    }
    if (c.confidence === 'likely') likely++;
    if (inDiff ? !inDiff(c.file) : !c.inChangedCode) outside++;
  }
  return { verified: callers.length - unverified, likely, unverified, outside };
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
    const overridingOwners = new Set(m.overriddenBy.map((id) => index.memberById.get(id)?.ownerTypeId ?? ownerTypeId(id)));
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

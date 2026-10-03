import type { MemberChange, TypeChange } from '../../../src/shared/types';
import { STATUS_ORDER } from './labels';

interface RowBase {
  key: string;
  type: TypeChange;
  /** Tip kartının ilk/son satırı (kenarlık ve boşluk için). */
  first?: boolean;
  last?: boolean;
}

export type StructureRow =
  | (RowBase & { kind: 'type' })
  | (RowBase & { kind: 'member'; member: MemberChange })
  | (RowBase & { kind: 'more'; unchanged: number });

const STATUS_RANK = new Map(STATUS_ORDER.map((s, i) => [s, i]));
const rank = (m: MemberChange) => STATUS_RANK.get(m.status) ?? 99;
const startOf = (m: MemberChange) => (m.newRange ?? m.oldRange)?.startLine ?? 0;

/** Yapı görünümünde tip kartının katlanma durumu anahtarı (layoutStore.closed). */
export const typeFoldKey = (typeId: string): string => `type:${typeId}`;

/**
 * Dosyanın tip/üye iskeleti düz satır listesi olarak (pencereleme için).
 * Değişmeyenler gizliyken üyeler önem sırasında (durum, sonra risk); gösterilince kaynak sırasında.
 * Katlanmış tiplerin (`folded`) yalnız başlık satırı çıkar.
 */
export function structureRows(types: readonly TypeChange[], showUnchanged: boolean, folded?: ReadonlySet<string>): StructureRow[] {
  const rows: StructureRow[] = [];
  types.forEach((type, ti) => {
    const startIdx = rows.length;
    rows.push({ kind: 'type', key: `t:${type.id}`, type, first: ti === 0 });
    if (folded?.has(type.id)) {
      const head = rows[rows.length - 1];
      if (head) head.last = true;
      return;
    }
    let unchanged = 0;
    const changed: MemberChange[] = [];
    for (const m of type.members) {
      if (m.status === 'unchanged') unchanged++;
      else changed.push(m);
    }
    const members = showUnchanged
      ? [...type.members].sort((a, b) => startOf(a) - startOf(b))
      : changed.sort((a, b) => rank(a) - rank(b) || b.risk.score - a.risk.score);
    for (const member of members) rows.push({ kind: 'member', key: `m:${member.id}`, type, member });
    if (unchanged > 0) rows.push({ kind: 'more', key: `more:${type.id}`, type, unchanged });
    const last = rows[rows.length - 1];
    if (last && rows.length > startIdx) last.last = true;
  });
  return rows;
}

/** Seçili sembolün satır anahtarı (üye ya da tip). */
export function structureKeyOf(symbolId: string | null, isMember: boolean): string | null {
  if (!symbolId) return null;
  return isMember ? `m:${symbolId}` : `t:${symbolId}`;
}

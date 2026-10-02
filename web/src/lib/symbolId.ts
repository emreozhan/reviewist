/**
 * Sembol kimliği ayrıştırma.
 *
 * Biçimler:
 *   'com.acme.Order'                         tip
 *   'com.acme.Order#total(int)'              üye
 *   'com.acme.Order@android/guava/src'       aynı FQN birden çok kaynak kökünde → kök soneki
 *   'com.acme.Order@android/guava/src#m()'   kök sonekli tipin üyesi
 *
 * Kök soneki yalnız `#`'den önceki kısımda aranır (parametre listesinde '@' geçebilir).
 */
export interface ParsedSymbolId {
  /** Kök soneki dahil sahip tip kimliği ('com.acme.Order@root'). Tip kimliğinde id'nin kendisi. */
  typeId: string;
  /** Kök soneki olmadan tam nitelikli ad ('com.acme.Order'). */
  fqn: string;
  /** Kaynak kökü ('android/guava/src'); yoksa undefined. */
  root?: string;
  /** '#' sonrası üye kısmı ('total(int)'); tipte undefined. */
  member?: string;
}

export function parseSymbolId(id: string): ParsedSymbolId {
  const hash = id.indexOf('#');
  const typeId = hash >= 0 ? id.slice(0, hash) : id;
  const member = hash >= 0 ? id.slice(hash + 1) : undefined;
  const at = typeId.indexOf('@');
  if (at < 0) return { typeId, fqn: typeId, member };
  const root = typeId.slice(at + 1).replace(/\/+$/, '');
  return { typeId, fqn: typeId.slice(0, at), root: root || undefined, member };
}

/** Üyenin sahip tip kimliği (kök soneki korunur); tip kimliğinde kendisi. */
export function ownerTypeId(id: string): string {
  return parseSymbolId(id).typeId;
}

/** FQN'in basit adı: 'com.acme.Outer.Inner' → 'Inner'. */
export function simpleTypeName(fqn: string): string {
  return fqn.slice(fqn.lastIndexOf('.') + 1);
}

/** Üye kısmından ad: 'total(int)' → 'total'; alan 'total' → 'total'. */
export function memberName(member: string): string {
  const paren = member.indexOf('(');
  return paren >= 0 ? member.slice(0, paren) : member;
}

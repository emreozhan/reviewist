import type {
  ChangeGroup,
  FileChange,
  Finding,
  ImpactNode,
  MemberChange,
  ReviewModel,
  ReviewStep,
  TypeChange,
} from '../../../src/shared/types';

/** ReviewModel üzerinde hızlı arama için önceden kurulmuş haritalar. */
export interface ReviewIndex {
  fileById: Map<string, FileChange>;
  typeById: Map<string, TypeChange>;
  memberById: Map<string, MemberChange>;
  /** Sembol (tip veya üye) → dosya yolu (yalnız diff içindekiler). */
  symbolFile: Map<string, string>;
  nodeById: Map<string, ImpactNode>;
  stepByFile: Map<string, ReviewStep>;
  findingsBySymbol: Map<string, Finding[]>;
  findingsByFile: Map<string, Finding[]>;
  groupsBySymbol: Map<string, ChangeGroup[]>;
  /** Taşınan/yeniden adlandırılan üyelerin eski kimliği → yeni üye. */
  membersByOldId: Map<string, MemberChange[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildIndex(review: ReviewModel): ReviewIndex {
  const fileById = new Map(review.files.map((f) => [f.id, f]));
  const typeById = new Map(review.types.map((t) => [t.id, t]));
  const memberById = new Map<string, MemberChange>();
  const symbolFile = new Map<string, string>();
  const membersByOldId = new Map<string, MemberChange[]>();
  for (const t of review.types) {
    symbolFile.set(t.id, t.file);
    for (const m of t.members) {
      memberById.set(m.id, m);
      symbolFile.set(m.id, t.file);
      if (m.oldId && m.oldId !== m.id) push(membersByOldId, m.oldId, m);
    }
  }
  const findingsBySymbol = new Map<string, Finding[]>();
  const findingsByFile = new Map<string, Finding[]>();
  for (const f of review.findings) {
    if (f.file) push(findingsByFile, f.file, f);
    for (const s of f.symbolIds ?? []) push(findingsBySymbol, s, f);
  }
  const groupsBySymbol = new Map<string, ChangeGroup[]>();
  for (const g of review.groups) for (const s of g.symbolIds) push(groupsBySymbol, s, g);
  return {
    fileById,
    typeById,
    memberById,
    symbolFile,
    nodeById: new Map(review.graph.nodes.map((n) => [n.id, n])),
    stepByFile: new Map(review.reviewPlan.map((s) => [s.fileId, s])),
    findingsBySymbol,
    findingsByFile,
    groupsBySymbol,
    membersByOldId,
  };
}

/** 'com.acme.Order#total(int)' → 'Order.total()' ; 'com.acme.Order' → 'Order'. */
export function shortId(id: string): string {
  const hash = id.indexOf('#');
  const typePart = hash >= 0 ? id.slice(0, hash) : id;
  const simple = typePart.slice(typePart.lastIndexOf('.') + 1);
  if (hash < 0) return simple;
  const member = id.slice(hash + 1);
  const paren = member.indexOf('(');
  return paren >= 0 ? `${simple}.${member.slice(0, paren)}()` : `${simple}.${member}`;
}

export function symbolLabel(index: ReviewIndex, id: string): string {
  const m = index.memberById.get(id);
  if (m) {
    const owner = index.typeById.get(m.ownerTypeId);
    const name = m.kind === 'field' ? m.name : `${m.name}()`;
    return owner ? `${owner.name}.${name}` : name;
  }
  const t = index.typeById.get(id);
  if (t) return t.name;
  return index.nodeById.get(id)?.label ?? shortId(id);
}

/** Sembol diff içindeyse dosyası; değilse graf düğümündeki dosya. */
export function symbolLocation(index: ReviewIndex, id: string): { file?: string; inDiff: boolean } {
  const inDiff = index.symbolFile.get(id);
  if (inDiff) return { file: inDiff, inDiff: true };
  return { file: index.nodeById.get(id)?.file, inDiff: false };
}

/**
 * Diff dışındaki bir sembol için onu etkileyen diff içi sembol: çağırdığı, override ettiği
 * ya da alt tipi olduğu değişen sembol.
 */
export function findAnchor(index: ReviewIndex, outsideId: string): string | undefined {
  for (const m of index.memberById.values()) {
    if (m.status === 'unchanged' && m.overriddenBy.length === 0) continue;
    if (m.callers.some((c) => c.fromId === outsideId)) return m.id;
    if (m.overriddenBy.includes(outsideId)) return m.status === 'unchanged' ? m.ownerTypeId : m.id;
  }
  for (const t of index.typeById.values()) if (t.subTypes.includes(outsideId)) return t.id;
  return undefined;
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Uzun dizin yolunu okunur kısaltır: 'src/main/java/com/shop/domain' → 'com/shop/domain'. */
export function compactDir(path: string): string {
  return dirName(path).replace(/^(.*\/)?src\/(main|test)\/(java|kotlin|resources)\/?/, '$2:');
}

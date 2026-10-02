import type { ReviewIndex } from './reviewIndex';
import { topLevelFqn } from './reviewIndex';
import { memberName, parseSymbolId, simpleTypeName } from './symbolId';

/** Diff dışındaki bir sembolün konumu: dosya, satır ve hangi taraftan okunacağı. */
export interface SymbolLocation {
  file?: string;
  line?: number;
  side: 'old' | 'new';
  inDiff: boolean;
  /** Dosya yolu paket adından tahmin edildi (sunucu konum vermedi). */
  guessed: boolean;
}

/** 'com.acme.Outer.Inner#m()' → 'com.acme.Outer' (büyük harfle başlayan ilk parça üst düzey tiptir; '@kök' soneki atılır). */
export function topLevelTypeId(symbolId: string): string {
  return topLevelFqn(symbolId);
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Sembolün dosya yolunu tahmin eder. Kimlikte kaynak kökü varsa ('Foo@android/guava/src') doğrudan kullanılır;
 * yoksa diff'teki tiplerden çıkarılmış kaynak köklerinden en uzun ortak paket önekine sahip olanı seçilir.
 */
export function guessFilePath(index: ReviewIndex, symbolId: string): string | undefined {
  const top = topLevelFqn(symbolId);
  if (!/^[\w.$]+$/.test(top)) return undefined;
  const rel = `${top.replace(/\./g, '/')}.java`;
  const { root } = parseSymbolId(symbolId);
  if (root) return `${root}/${rel}`;
  let best: { root: string; score: number } | undefined;
  for (const r of index.sourceRoots) {
    const score = commonPrefixLength(r.pkg, top);
    if (!best || score > best.score) best = { root: r.root, score };
  }
  return best ? `${best.root}${rel}` : undefined;
}

/** Sembolün konumu: diff içindeyse üye/tip aralığı; değilse graf düğümünün `range`'i; yoksa üst tip düğümü ya da tahmin. */
export function locateSymbol(index: ReviewIndex, id: string): SymbolLocation {
  const m = index.memberById.get(id);
  const t = index.typeById.get(id);
  const diffFile = index.symbolFile.get(id);
  if (diffFile) {
    const range = m?.newRange ?? t?.newRange;
    const old = m?.oldRange ?? t?.oldRange;
    return { file: diffFile, line: (range ?? old)?.startLine, side: range ? 'new' : 'old', inDiff: true, guessed: false };
  }
  const node = index.nodeById.get(id);
  if (node?.file) {
    const side = node.rangeSide ?? 'new';
    // Silinmiş sembolün aralığı eski taraftadır; dosya yeniden adlandırıldıysa node.file yeni yolu gösterebilir.
    const fc = side === 'old' ? index.fileById.get(node.file) : undefined;
    const file = fc ? (fc.oldPath ?? fc.path) : node.file;
    return { file, line: node.range?.startLine, side, inDiff: false, guessed: false };
  }
  const ownerId = parseSymbolId(id).typeId;
  const owner = ownerId !== id ? index.nodeById.get(ownerId) : undefined;
  if (owner?.file) return { file: owner.file, side: 'new', inDiff: false, guessed: false };
  const guess = guessFilePath(index, id);
  return { file: guess, side: 'new', inDiff: false, guessed: !!guess };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * İçerikte bildirim satırını arar (yalnız sunucu aralık vermediğinde yedek olarak).
 * Tip için 'class|interface|enum|record Ad', üye için çağrı değil bildirim gibi görünen 'ad(' satırı.
 */
export function findDeclarationLine(lines: readonly string[], symbolId: string): number | undefined {
  const { fqn, member } = parseSymbolId(symbolId);
  if (member === undefined) {
    const name = escapeRe(simpleTypeName(fqn));
    const re = new RegExp(`\\b(class|interface|enum|record|@interface)\\s+${name}\\b`);
    const i = lines.findIndex((l) => re.test(l));
    return i >= 0 ? i + 1 : undefined;
  }
  const isCall = member.includes('(');
  const name = escapeRe(memberName(member));
  // Bildirim: adın önünde bir tip/niteleyici (kelime, >, ]) olur; '.' ya da '=' sonrası çağrıdır.
  const decl = isCall ? new RegExp(`[\\w>\\]]\\s+${name}\\s*\\(`) : new RegExp(`[\\w>\\]]\\s+${name}\\s*(=|;)`);
  const call = new RegExp(`([.=]|\\bnew)\\s*${name}\\s*\\(`);
  const i = lines.findIndex((l) => {
    const s = l.trim();
    if (s.startsWith('//') || s.startsWith('*') || s.startsWith('return ')) return false;
    return decl.test(s) && !call.test(s);
  });
  return i >= 0 ? i + 1 : undefined;
}

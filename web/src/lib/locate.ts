import type { ReviewIndex } from './reviewIndex';

/** Diff dışındaki bir sembolün konumu: dosya, satır ve hangi taraftan okunacağı. */
export interface SymbolLocation {
  file?: string;
  line?: number;
  side: 'old' | 'new';
  inDiff: boolean;
  /** Dosya yolu paket adından tahmin edildi (sunucu konum vermedi). */
  guessed: boolean;
}

/** 'com.acme.Outer.Inner#m()' → 'com.acme.Outer' (büyük harfle başlayan ilk parça üst düzey tiptir). */
export function topLevelTypeId(symbolId: string): string {
  const typePart = symbolId.split('#')[0] ?? symbolId;
  const parts = typePart.split('.');
  const i = parts.findIndex((p) => /^[A-Z]/.test(p));
  return i < 0 ? typePart : parts.slice(0, i + 1).join('.');
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Diff'teki tiplerin dosya yollarından kaynak kökünü (ör. 'src/main/java/') çıkarıp
 * sembolün dosya yolunu tahmin eder. En uzun ortak paket önekine sahip tipin kökü seçilir.
 */
export function guessFilePath(index: ReviewIndex, symbolId: string): string | undefined {
  const top = topLevelTypeId(symbolId);
  if (!/^[\w.$]+$/.test(top)) return undefined;
  let best: { root: string; score: number } | undefined;
  for (const t of index.typeById.values()) {
    const suffix = `${topLevelTypeId(t.id).replace(/\./g, '/')}.java`;
    if (!t.file.endsWith(suffix)) continue;
    const root = t.file.slice(0, t.file.length - suffix.length);
    const score = commonPrefixLength(t.id, top);
    if (!best || score > best.score) best = { root, score };
  }
  return best ? `${best.root}${top.replace(/\./g, '/')}.java` : undefined;
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
  const ownerId = id.split('#')[0] ?? id;
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
  const hash = symbolId.indexOf('#');
  if (hash < 0) {
    const name = escapeRe(symbolId.slice(symbolId.lastIndexOf('.') + 1));
    const re = new RegExp(`\\b(class|interface|enum|record|@interface)\\s+${name}\\b`);
    const i = lines.findIndex((l) => re.test(l));
    return i >= 0 ? i + 1 : undefined;
  }
  const member = symbolId.slice(hash + 1);
  const paren = member.indexOf('(');
  const name = escapeRe(paren >= 0 ? member.slice(0, paren) : member);
  // Bildirim: adın önünde bir tip/niteleyici (kelime, >, ]) olur; '.' ya da '=' sonrası çağrıdır.
  const decl = paren >= 0 ? new RegExp(`[\\w>\\]]\\s+${name}\\s*\\(`) : new RegExp(`[\\w>\\]]\\s+${name}\\s*(=|;)`);
  const i = lines.findIndex((l) => {
    const s = l.trim();
    if (s.startsWith('//') || s.startsWith('*') || s.startsWith('return ')) return false;
    return decl.test(s) && !new RegExp(`([.=]|\\bnew)\\s*${name}\\s*\\(`).test(s);
  });
  return i >= 0 ? i + 1 : undefined;
}

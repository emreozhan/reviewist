/**
 * Klavye kısayollarının kapanması gereken hedefler: yalnız metin girilen alanlar (metin/arama kutuları, textarea,
 * select, contenteditable). Onay kutusu, radyo, düğme gibi öğeler odaktayken kısayollar çalışmaya devam eder.
 */

/** Metin girişi kabul etmeyen `<input>` türleri. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'range',
  'color',
  'hidden',
]);

export interface KeyTargetLike {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Saf: öğe bir metin giriş alanı mı? */
export function isTextEntry(el: KeyTargetLike): boolean {
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUT_TYPES.has((el.type ?? 'text').toLowerCase());
}

/** Olay hedefi bir metin giriş alanıysa true (tek harfli kısayollar kapanır). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const type = target instanceof HTMLInputElement ? target.type : undefined;
  return isTextEntry({ tagName: target.tagName, type, isContentEditable: target.isContentEditable });
}

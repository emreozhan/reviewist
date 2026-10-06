/**
 * Yerelden (locale) bağımsız, deterministik dize karşılaştırması.
 *
 * `String.prototype.localeCompare` süreç yereline bağlıdır: Türkçe ve İngilizce yerelde `id`/`ID_PREFIX`,
 * `Item.java`/`ia.java` sırası farklı çıkar. Çıktının makineden makineye değişmemesi için core içindeki tüm
 * sıralamalar UTF-16 kod birimi sırasıyla (varsayılan `Array.prototype.sort` ile aynı) yapılır.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

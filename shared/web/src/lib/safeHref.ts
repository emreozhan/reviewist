/**
 * Dış bağlantı adresi doğrulaması: yalnız mutlak http/https adresleri kabul edilir. `javascript:`, `data:`,
 * `vbscript:`, göreli ya da bozuk adresler için undefined döner (bağlantı çizilmez).
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (trimmed === '') return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

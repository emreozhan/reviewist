/**
 * Platform algılama (kısayol etiketleri ve yer tutucular için). Tarayıcı dışı (SSR/test) ortamlarda güvenlidir:
 * `navigator` yoksa platform "bilinmiyor" sayılır (macOS değil, Windows değil).
 */

interface NavigatorLike {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

/** Saf: platform dizesi macOS'u (ya da iPadOS/iOS gibi ⌘ kullanan Apple sistemlerini) gösteriyor mu? */
export function detectMac(platform: string | undefined | null): boolean {
  if (!platform) return false;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Saf: platform dizesi Windows'u gösteriyor mu? */
export function detectWindows(platform: string | undefined | null): boolean {
  if (!platform) return false;
  return /win/i.test(platform) && !/darwin/i.test(platform);
}

/** Tarayıcının bildirdiği platform dizesi (önce userAgentData, sonra navigator.platform, en son userAgent). */
export function platformString(nav: NavigatorLike | undefined): string {
  if (!nav) return '';
  return nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
}

function currentNavigator(): NavigatorLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike);
}

const PLATFORM = platformString(currentNavigator());

export const IS_MAC: boolean = detectMac(PLATFORM);
export const IS_WINDOWS: boolean = detectWindows(PLATFORM);

/** Birincil değiştirici tuş etiketi: macOS'ta ⌘, diğerlerinde Ctrl. */
export const modLabel: '⌘' | 'Ctrl' = IS_MAC ? '⌘' : 'Ctrl';
/** Alt tuşu etiketi: macOS'ta ⌥, diğerlerinde Alt. */
export const altLabel: '⌥' | 'Alt' = IS_MAC ? '⌥' : 'Alt';

/** Örnek depo yolu yer tutucusu: Windows'ta `C:\projeler\shop`, diğerlerinde `~/projeler/shop`. */
export function samplePathFor(windows: boolean): string {
  return windows ? 'C:\\projeler\\shop' : '~/projeler/shop';
}

export const SAMPLE_REPO_PATH: string = samplePathFor(IS_WINDOWS);

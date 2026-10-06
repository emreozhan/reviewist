/** Klasör seçici için yol yardımcıları (sunucu platformundan bağımsız: Windows ve POSIX yolları). */

export interface PathCrumb {
  /** Görünen ad (sürücü için 'C:', POSIX kökü için '/'). */
  label: string;
  /** Bu kırıntıya tıklanınca gidilecek mutlak yol. */
  path: string;
}

/** `C:\…`, `C:/…` ya da `\\sunucu\…` biçiminde mi. */
export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith('\\\\');
}

/** Mutlak yolu tıklanabilir kırıntılara ayırır. Sondaki ayırıcılar yok sayılır; Windows'ta `/` → `\`. */
export function pathCrumbs(input: string): PathCrumb[] {
  const p = input.trim();
  if (p === '') return [];
  if (isWindowsPath(p)) {
    const w = p.replace(/\//g, '\\');
    let rootLabel: string;
    let rootPath: string;
    let rest: string;
    const unc = /^\\\\([^\\]+)\\([^\\]+)(.*)$/.exec(w);
    if (unc) {
      rootPath = `\\\\${unc[1]}\\${unc[2]}`;
      rootLabel = rootPath;
      rest = unc[3] ?? '';
    } else {
      rootLabel = w.slice(0, 2).toUpperCase();
      rootPath = `${w.slice(0, 2)}\\`;
      rest = w.slice(2);
    }
    const crumbs: PathCrumb[] = [{ label: rootLabel, path: rootPath }];
    let acc = rootPath.endsWith('\\') ? rootPath.slice(0, -1) : rootPath;
    for (const seg of rest.split('\\').filter(Boolean)) {
      acc = `${acc}\\${seg}`;
      crumbs.push({ label: seg, path: acc });
    }
    return crumbs;
  }
  if (p.startsWith('/')) {
    const crumbs: PathCrumb[] = [{ label: '/', path: '/' }];
    let acc = '';
    for (const seg of p.split('/').filter(Boolean)) {
      acc = `${acc}/${seg}`;
      crumbs.push({ label: seg, path: acc });
    }
    return crumbs;
  }
  return [{ label: p, path: p }];
}

/**
 * Karşılaştırma anahtarı: sondaki ayırıcı atılır; Windows yolları büyük/küçük harf ve ayırıcı duyarsız.
 * Unicode NFC'ye çevrilir (macOS/Finder ayrışık NFD adlar üretebilir: "Çalışmalar" iki biçimde de aynı anahtar).
 * Yalnız karşılaştırma içindir; yolun kendisi değiştirilmeden saklanır.
 */
export function pathKey(p: string): string {
  const t = p.trim().normalize('NFC');
  if (isWindowsPath(t)) {
    const w = t.replace(/\//g, '\\');
    const trimmed = /^[A-Za-z]:\\$/.test(w) ? w : w.replace(/\\+$/, '');
    return trimmed.toLowerCase();
  }
  return t.length > 1 ? t.replace(/\/+$/, '') : t;
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** Yolun son bileşeni (kök için kendisi). */
export function baseName(p: string): string {
  const crumbs = pathCrumbs(p);
  return crumbs[crumbs.length - 1]?.label ?? p;
}

/**
 * git çalıştırılabilir dosyasının çözümü. Sunucu PATH'i eksik bir ortamdan başlatıldığında (ör. bir masaüstü
 * başlatıcısı ya da Electron uygulamasının açtığı `npm start`) `git` PATH'te bulunamaz; bu durumda bilinen kurulum
 * yerlerine bakılır. Bulunan sonuç süreç boyunca, "bulunamadı" sonucu kısa süre önbelleklenir.
 *
 * Sıra: REVIEWIST_GIT ortam değişkeni → PATH'teki git → (Windows) Git for Windows kayıt defteri kurulum yolu →
 * bilinen klasörler (Windows: Program Files, Scoop, Chocolatey; macOS/Linux: Homebrew, MacPorts, sistem).
 *
 * Güvenlik: git HER ZAMAN mutlak yoluyla çalıştırılır. Windows'ta uzantısız bir komut önce çalışma dizininde aranır;
 * çıplak `git` çalıştırmak, incelenen deponun içine konmuş bir `git.exe`'nin çalışmasına yol açardı. PATH elle taranır
 * ve göreli PATH girdileri (`.` gibi) atlanır.
 *
 * macOS: `/usr/bin/git` gerçek git değil, Xcode yönlendiricisidir. Command Line Tools kurulu değilken çalıştırılırsa
 * hata verir ve kurulum penceresi açabilir; bu yüzden yalnızca geliştirici araçları hazırsa denenir.
 */
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export interface GitBinaryInfo {
  /** spawn'a verilecek komut: her zaman mutlak yol (bulunamadıysa `git`; bu durumda çalıştırılmaz). */
  command: string;
  /** Nereden bulundu: 'env' | 'path' | 'registry' | 'known' | 'none'. */
  source: 'env' | 'path' | 'registry' | 'known' | 'none';
  /** Denenen adaylar (hata mesajı için). */
  tried: string[];
}

const XCODE_SHIM = '/usr/bin/git';
/** Windows sistem aracı: mutlak yol (çalışma dizinindeki aynı adlı dosya çalışmasın). */
const SYSTEM_REG = join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'reg.exe');
/** "Bulunamadı" sonucu bu süre boyunca yeniden aranmaz (her git çağrısında süreç başlatmamak için). */
const NOT_FOUND_TTL_MS = 30_000;

let cached: GitBinaryInfo | undefined;
let notFound: { info: GitBinaryInfo; until: number } | undefined;

function works(command: string): boolean {
  try {
    const r = spawnSync(command, ['--version'], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
    return r.status === 0 && /git version/i.test(r.stdout ?? '');
  } catch {
    return false;
  }
}

/** PATH klasörlerindeki ilk çalıştırılabilir git dosyasının mutlak yolu. Göreli PATH girdileri atlanır. */
function findOnPath(): string | undefined {
  const exe = process.platform === 'win32' ? 'git.exe' : 'git';
  const pathVar = process.env.PATH ?? process.env.Path ?? '';
  for (const raw of pathVar.split(delimiter)) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, exe);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* bu klasörde yok */
    }
  }
  return undefined;
}

/** macOS: Xcode geliştirici araçları (Command Line Tools ya da Xcode) kurulu ve içinde git var mı. */
function xcodeToolsReady(): boolean {
  try {
    const r = spawnSync('/usr/bin/xcode-select', ['-p'], { timeout: 3000, encoding: 'utf8' });
    const dir = (r.stdout ?? '').trim();
    return r.status === 0 && dir !== '' && existsSync(join(dir, 'usr', 'bin', 'git'));
  } catch {
    return false;
  }
}

/** Git for Windows'un kayıt defterindeki kurulum klasörü (HKLM/HKCU, 64/32 bit). */
function registryInstallPaths(): string[] {
  const out: string[] = [];
  for (const key of ['HKLM\\SOFTWARE\\GitForWindows', 'HKCU\\SOFTWARE\\GitForWindows', 'HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows']) {
    try {
      const r = spawnSync(SYSTEM_REG, ['query', key, '/v', 'InstallPath'], { windowsHide: true, timeout: 3000, encoding: 'utf8' });
      const m = /InstallPath\s+REG_\w+\s+(.+)/i.exec(r.stdout ?? '');
      if (m?.[1]) out.push(join(m[1].trim(), 'cmd', 'git.exe'));
    } catch {
      /* reg yoksa ya da anahtar yoksa geç */
    }
  }
  return out;
}

function knownLocations(): string[] {
  if (process.platform === 'win32') {
    const env = process.env;
    const roots = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(
      (r): r is string => !!r,
    );
    const list = roots.map((r) => join(r, 'Git', 'cmd', 'git.exe'));
    if (env.LOCALAPPDATA) list.push(join(env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'));
    if (env.USERPROFILE) list.push(join(env.USERPROFILE, 'scoop', 'shims', 'git.exe'));
    if (env.ChocolateyInstall) list.push(join(env.ChocolateyInstall, 'bin', 'git.exe'));
    return [...new Set(list)];
  }
  // Homebrew (Apple Silicon, Intel), MacPorts, sonra sistem yolları.
  return ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/opt/local/bin/git', XCODE_SHIM];
}

function probe(): GitBinaryInfo {
  const tried: string[] = [];
  const darwin = process.platform === 'darwin';
  let xcodeReady: boolean | undefined;
  /** Aday çalışıyor mu; macOS yönlendiricisi yalnızca geliştirici araçları hazırsa çalıştırılır. */
  const usable = (candidate: string): boolean => {
    if (darwin && candidate === XCODE_SHIM) {
      xcodeReady ??= xcodeToolsReady();
      if (!xcodeReady) {
        tried.push(`${candidate} (Xcode Command Line Tools kurulu değil)`);
        return false;
      }
    }
    tried.push(candidate);
    return existsSync(candidate) && works(candidate);
  };

  const fromEnv = process.env.REVIEWIST_GIT?.trim();
  if (fromEnv) {
    if (!isAbsolute(fromEnv)) tried.push(`${fromEnv} (REVIEWIST_GIT mutlak yol olmalı)`);
    else if (usable(fromEnv)) return { command: fromEnv, source: 'env', tried };
  }

  const onPath = findOnPath();
  if (onPath === undefined) tried.push('git (PATH içinde yok)');
  else if (usable(onPath)) return { command: onPath, source: 'path', tried };

  if (process.platform === 'win32') {
    for (const p of registryInstallPaths()) {
      if (tried.includes(p)) continue;
      if (usable(p)) return { command: p, source: 'registry', tried };
    }
  }

  for (const p of knownLocations()) {
    if (tried.includes(p) || tried.some((t) => t.startsWith(`${p} (`))) continue;
    if (usable(p)) return { command: p, source: 'known', tried };
  }
  return { command: 'git', source: 'none', tried };
}

/** git komutunu çözer (önbellekli). Bulunamazsa command 'git' ve source 'none' döner. */
export function resolveGitBinary(): GitBinaryInfo {
  if (cached) return cached;
  if (notFound && Date.now() < notFound.until) return notFound.info;
  const info = probe();
  if (info.source === 'none') {
    // Kısa süreli önbellek: kullanıcı git'i kurup tekrar denediğinde yeniden aranır.
    notFound = { info, until: Date.now() + NOT_FOUND_TTL_MS };
    return info;
  }
  notFound = undefined;
  cached = info;
  return info;
}

/** Testler için önbelleği sıfırlar. */
export function resetGitBinaryCache(): void {
  cached = undefined;
  notFound = undefined;
}

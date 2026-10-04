/**
 * git çalıştırılabilir dosyasının çözümü. Sunucu PATH'i eksik bir ortamdan başlatıldığında
 * (ör. bir Electron uygulamasının açtığı `npm start`) `git` PATH'te bulunamaz; bu durumda
 * bilinen kurulum yerlerine bakılır. Sonuç süreç boyunca önbelleklenir.
 *
 * Sıra: REVIEWIST_GIT ortam değişkeni → PATH'teki `git` → (Windows) Git for Windows kayıt defteri
 * kurulum yolu ve bilinen klasörler → (macOS/Linux) Homebrew ve sistem yolları.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface GitBinaryInfo {
  /** spawn'a verilecek komut (`git` ya da mutlak yol). */
  command: string;
  /** Nereden bulundu: 'env' | 'path' | 'registry' | 'known' | 'none'. */
  source: 'env' | 'path' | 'registry' | 'known' | 'none';
  /** Denenen adaylar (hata mesajı için). */
  tried: string[];
}

let cached: GitBinaryInfo | undefined;

function works(command: string): boolean {
  try {
    const r = spawnSync(command, ['--version'], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
    return r.status === 0 && /git version/i.test(r.stdout ?? '');
  } catch {
    return false;
  }
}

/** Git for Windows'un kayıt defterindeki kurulum klasörü (HKLM/HKCU, 64/32 bit). */
function registryInstallPaths(): string[] {
  const out: string[] = [];
  for (const key of ['HKLM\\SOFTWARE\\GitForWindows', 'HKCU\\SOFTWARE\\GitForWindows', 'HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows']) {
    try {
      const r = spawnSync('reg', ['query', key, '/v', 'InstallPath'], { windowsHide: true, timeout: 3000, encoding: 'utf8' });
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
  return ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/opt/local/bin/git'];
}

/** git komutunu çözer (önbellekli). Bulunamazsa command 'git' ve source 'none' döner. */
export function resolveGitBinary(): GitBinaryInfo {
  if (cached) return cached;
  const tried: string[] = [];
  const fromEnv = process.env.REVIEWIST_GIT?.trim();
  if (fromEnv) {
    tried.push(fromEnv);
    if (works(fromEnv)) return (cached = { command: fromEnv, source: 'env', tried });
  }
  tried.push('git (PATH)');
  if (works('git')) return (cached = { command: 'git', source: 'path', tried });
  if (process.platform === 'win32') {
    for (const p of registryInstallPaths()) {
      tried.push(p);
      if (existsSync(p) && works(p)) return (cached = { command: p, source: 'registry', tried });
    }
  }
  for (const p of knownLocations()) {
    tried.push(p);
    if (existsSync(p) && works(p)) return (cached = { command: p, source: 'known', tried });
  }
  // Bulunamadı: önbelleğe alma — kullanıcı git'i kurup tekrar denediğinde yeniden aransın.
  return { command: 'git', source: 'none', tried };
}

/** Testler için önbelleği sıfırlar. */
export function resetGitBinaryCache(): void {
  cached = undefined;
}

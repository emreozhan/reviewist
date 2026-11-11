/**
 * Varsayılan tarayıcıda bir adres açar. Dış paket yerine işletim sisteminin kendi komutu kullanılır:
 * macOS `open`, Windows `rundll32 url.dll,FileProtocolHandler`, diğerleri `xdg-open`.
 * Yalnızca http(s) adresleri kabul edilir (komut satırına başka bir şey geçmez).
 */
import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

export interface OpenCommand {
  command: string;
  args: string[];
}

/**
 * Platforma göre çalıştırılacak komut (test edilebilir, yan etkisiz). Sistem araçları mutlak yolla çağrılır:
 * Windows'ta uzantısız komut önce çalışma dizininde aranır; oradaki aynı adlı bir dosya çalışmamalı.
 */
export function openCommandFor(
  url: string,
  platform: NodeJS.Platform = process.platform,
  systemRoot: string = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows',
): OpenCommand {
  if (!/^https?:\/\//i.test(url)) throw new Error(`Yalnızca http(s) adresleri açılabilir: ${url}`);
  if (platform === 'darwin') return { command: '/usr/bin/open', args: [url] };
  if (platform === 'win32') return { command: win32.join(systemRoot, 'System32', 'rundll32.exe'), args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}

/** Tarayıcıyı açmayı dener; komut yoksa ya da başarısız olursa reddeder (çağıran uyarı basar). */
export function openBrowser(url: string): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    let cmd: OpenCommand;
    try {
      cmd = openCommandFor(url);
    } catch (err) {
      rejectOpen(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const child = spawn(cmd.command, cmd.args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.once('error', (err) => rejectOpen(err));
    child.once('spawn', () => {
      child.unref();
      resolveOpen();
    });
  });
}

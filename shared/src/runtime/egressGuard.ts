/**
 * Çıkış bekçisi: bu Node sürecinin (ve içine gömülü üçüncü taraf kütüphanelerin) dışarıya bağlantı açmasını engeller.
 *
 *  - TCP/TLS (http, https, fetch, WebSocket… hepsi `net.Socket.connect` üzerinden geçer): yalnız loopback ve izin
 *    listesindeki sunucu adlarına izin verilir.
 *  - DNS sorguları (`dns.lookup`, `dns.resolve*`, promises): yalnız loopback ve izinli adlar (DNS üzerinden veri
 *    sızdırmaya karşı).
 *  - UDP (`dgram`): tamamen kapalı (uygulama UDP kullanmaz).
 *
 * Yerel uygulamada izin listesi boştur: süreç ağa hiç çıkamaz. GitHub uygulamasında yalnız GitHub API sunucuları
 * izinlidir.
 *
 * SINIR: bu süreç içi bir önlemdir. Kazara ya da "telemetri" tarzı sızıntıyı ve sıradan kötü amaçlı kodu durdurur;
 * alt süreç başlatan ya da yerel eklenti yükleyen kararlı bir saldırganı durdurmaz. Kesin yalıtım için işletim
 * sistemi güvenlik duvarı gerekir. `git` alt süreci bu bekçinin dışındadır (yerel uygulamada git'in ağ erişimi ayrıca
 * `protocol.allow=never` ile kapatılır).
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';

export interface EgressGuardOptions {
  /** İzinli sunucu adları (küçük harf, tam eşleşme). Her bağlantıda yeniden okunur. Varsayılan: hiçbiri. */
  allowHosts?: () => Iterable<string>;
  /** Engellenen her deneme için çağrılır (varsayılan: hedef başına bir kez konsola uyarı). */
  onBlocked?: (target: string, kind: 'tcp' | 'dns' | 'udp') => void;
}

export class EgressBlockedError extends Error {
  readonly code = 'EREVIEWIST_EGRESS';
  constructor(readonly target: string) {
    super(`Reviewist çıkış bekçisi: dış bağlantı engellendi (${target}).`);
    this.name = 'EgressBlockedError';
  }
}

/** Loopback adresi/adı mı: localhost, 127.0.0.0/8, ::1 (köşeli parantezli ve IPv4-eşlemeli biçimler dahil). */
export function isLoopbackTarget(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  if (h.startsWith('::ffff:')) h = h.slice('::ffff:'.length);
  return /^127(\.\d{1,3}){3}$/.test(h);
}

type AnyFn = (...args: never[]) => unknown;

let installed: { uninstall: () => void } | undefined;

/** Bekçiyi kurar (ikinci çağrı öncekini değiştirir). Dönen işlev özgün davranışı geri yükler (testler için). */
export function installEgressGuard(opts: EgressGuardOptions = {}): () => void {
  installed?.uninstall();
  const warned = new Set<string>();
  const report =
    opts.onBlocked ??
    ((target: string, kind: string): void => {
      const key = `${kind}:${target}`;
      if (warned.has(key)) return;
      warned.add(key);
      console.warn(`[reviewist] Engellenen dış bağlantı (${kind}): ${target}`);
    });
  const allowed = (host: string): boolean => {
    if (isLoopbackTarget(host)) return true;
    const h = host.trim().toLowerCase();
    for (const a of opts.allowHosts?.() ?? []) if (a.toLowerCase() === h) return true;
    return false;
  };

  const restore: (() => void)[] = [];
  const patch = <T extends object, K extends keyof T>(obj: T, key: K, make: (orig: T[K]) => T[K]): void => {
    const orig = obj[key];
    if (typeof orig !== 'function') return;
    obj[key] = make(orig);
    restore.push(() => {
      obj[key] = orig;
    });
  };

  // --- TCP / TLS -------------------------------------------------------------
  patch(net.Socket.prototype, 'connect', (orig) => {
    const original = orig as unknown as (this: net.Socket, ...args: unknown[]) => net.Socket;
    return function connect(this: net.Socket, ...args: unknown[]): net.Socket {
      // net.connect, argümanları önceden normalize edip dizi olarak geçirebilir: [seçenekler, geri çağrı].
      const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
      let host: string | undefined;
      let port: unknown;
      if (typeof first === 'object' && first !== null) {
        const o = first as { host?: unknown; port?: unknown; path?: unknown };
        if (typeof o.path === 'string') return original.apply(this, args); // yerel IPC (pipe / unix soketi)
        host = typeof o.host === 'string' ? o.host : 'localhost';
        port = o.port;
      } else if (typeof first === 'string' && Number.isNaN(Number(first))) {
        return original.apply(this, args); // connect(path): yerel IPC
      } else {
        port = first;
        host = typeof args[1] === 'string' ? args[1] : 'localhost';
      }
      if (allowed(host)) return original.apply(this, args);
      const target = `${host}:${String(port)}`;
      report(target, 'tcp');
      process.nextTick(() => this.destroy(new EgressBlockedError(target)));
      return this;
    } as unknown as typeof net.Socket.prototype.connect;
  });

  // --- DNS -------------------------------------------------------------------
  const guardDns = <F extends AnyFn>(orig: F, promise: boolean): F =>
    function guarded(this: unknown, ...args: unknown[]): unknown {
      const host = typeof args[0] === 'string' ? args[0] : '';
      if (allowed(host)) return (orig as unknown as (...a: unknown[]) => unknown).apply(this, args);
      report(host, 'dns');
      const err = new EgressBlockedError(host);
      if (promise) return Promise.reject(err);
      const cb = args[args.length - 1];
      if (typeof cb === 'function') process.nextTick(() => (cb as (e: Error) => void)(err));
      return undefined;
    } as unknown as F;
  const DNS_FNS = ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveTxt', 'resolveSrv', 'resolvePtr', 'resolveNaptr', 'resolveSoa', 'resolveCaa'] as const;
  for (const name of DNS_FNS) {
    patch(dns as unknown as Record<string, AnyFn>, name, (orig) => guardDns(orig, false));
    patch(dns.promises as unknown as Record<string, AnyFn>, name, (orig) => guardDns(orig, true));
    patch(dns.Resolver.prototype as unknown as Record<string, AnyFn>, name, (orig) => guardDns(orig, false));
    patch(dns.promises.Resolver.prototype as unknown as Record<string, AnyFn>, name, (orig) => guardDns(orig, true));
  }

  // --- UDP: tamamen kapalı ---------------------------------------------------
  for (const name of ['send', 'connect'] as const) {
    patch(dgram.Socket.prototype as unknown as Record<string, AnyFn>, name, () => {
      return function blocked(): never {
        report('udp', 'udp');
        throw new EgressBlockedError('udp');
      } as unknown as AnyFn;
    });
  }

  syncBuiltinESMExports();
  const uninstall = (): void => {
    for (const r of restore.reverse()) r();
    syncBuiltinESMExports();
    if (installed?.uninstall === uninstall) installed = undefined;
  };
  installed = { uninstall };
  return uninstall;
}

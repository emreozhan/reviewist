import dns from 'node:dns';
import dgram from 'node:dgram';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { EgressBlockedError, installEgressGuard, isLoopbackTarget } from './egressGuard.js';

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

function listen(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolveListen) => {
    const server = http.createServer((_req, res) => res.end('tamam'));
    server.listen(0, '127.0.0.1', () => resolveListen({ server, port: (server.address() as AddressInfo).port }));
  });
}

describe('isLoopbackTarget', () => {
  it('loopback adlarını ve adreslerini tanır', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '::ffff:127.0.0.1', 'app.localhost']) {
      expect(isLoopbackTarget(h), h).toBe(true);
    }
    for (const h of ['example.com', '10.0.0.1', '192.168.1.1', '128.0.0.1', '0.0.0.0', 'localhost.evil.example', '169.254.169.254']) {
      expect(isLoopbackTarget(h), h).toBe(false);
    }
  });
});

describe('installEgressGuard', () => {
  it('loopback bağlantısına izin verir (fetch dahil)', async () => {
    const { server, port } = await listen();
    try {
      uninstall = installEgressGuard();
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe('tamam');
    } finally {
      server.close();
    }
  });

  it('dış TCP bağlantısını ağa çıkmadan engeller ve bildirir', async () => {
    const blocked: string[] = [];
    uninstall = installEgressGuard({ onBlocked: (t, kind) => blocked.push(`${kind}:${t}`) });
    // TEST-NET-1 (belgeleme için ayrılmış adres): bekçi olmasa bağlantı zaman aşımına uğrardı.
    const err = await new Promise<Error>((resolveErr) => {
      const s = net.connect({ host: '192.0.2.1', port: 443 });
      s.once('error', resolveErr);
    });
    expect(err).toBeInstanceOf(EgressBlockedError);
    expect(blocked).toContain('tcp:192.0.2.1:443');
  });

  it('fetch ile dış adrese istek reddedilir', async () => {
    uninstall = installEgressGuard({ onBlocked: () => undefined });
    await expect(fetch('https://example.invalid/veri?x=1')).rejects.toThrow();
  });

  it('DNS sorgularını engeller (geri çağrılı ve promise)', async () => {
    const blocked: string[] = [];
    uninstall = installEgressGuard({ onBlocked: (t, kind) => blocked.push(`${kind}:${t}`) });
    const err = await new Promise<Error | null>((resolveErr) => dns.lookup('sizinti.example.invalid', (e) => resolveErr(e)));
    expect(err).toBeInstanceOf(EgressBlockedError);
    await expect(dns.promises.resolve4('sizinti2.example.invalid')).rejects.toBeInstanceOf(EgressBlockedError);
    expect(blocked).toEqual(['dns:sizinti.example.invalid', 'dns:sizinti2.example.invalid']);
    // loopback adı çözülebilir
    const ok = await dns.promises.lookup('localhost');
    expect(ok.address).toBeTruthy();
  });

  it('izin listesindeki sunucu adı engellenmez (bekçi katmanında)', async () => {
    const blocked: string[] = [];
    uninstall = installEgressGuard({ allowHosts: () => ['api.github.com'], onBlocked: (t) => blocked.push(t) });
    // Gerçek ağa çıkmamak için yalnız DNS katmanı sınanır: izinli ad bekçiden geçer (sonuç ağ durumuna bağlıdır),
    // izinsiz ad bekçide kalır.
    await dns.promises.lookup('api.github.com').catch(() => undefined);
    await dns.promises.lookup('evil.example.invalid').catch(() => undefined);
    expect(blocked).toEqual(['evil.example.invalid']);
  });

  it('UDP gönderimi tamamen kapalıdır', () => {
    uninstall = installEgressGuard({ onBlocked: () => undefined });
    const sock = dgram.createSocket('udp4');
    try {
      expect(() => sock.send(Buffer.from('x'), 53, '192.0.2.1')).toThrow(EgressBlockedError);
    } finally {
      sock.close();
    }
  });

  it('kaldırılınca özgün davranış geri gelir', async () => {
    const before = net.Socket.prototype.connect;
    uninstall = installEgressGuard();
    expect(net.Socket.prototype.connect).not.toBe(before);
    uninstall();
    uninstall = undefined;
    expect(net.Socket.prototype.connect).toBe(before);
  });
});

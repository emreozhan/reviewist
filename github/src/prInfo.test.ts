import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EgressBlockedError } from '../../shared/src/runtime/egressGuard.js';
import { fetchPrInfo } from './prInfo.js';
import { parseRemoteSpec } from './remote.js';

const TOKEN = 'test-token-should-never-leak-123';

interface Call {
  url: string;
  headers: Record<string, string>;
  redirect?: RequestRedirect;
}
let calls: Call[] = [];

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function stubFetch(handler: (url: URL) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    calls.push({ url: url.href, headers, redirect: init?.redirect });
    return await handler(url);
  });
}

const pull = {
  number: 7,
  title: 'Sipariş servisi',
  body: 'Açıklama **md**',
  html_url: 'https://github.com/acme/shop/pull/7',
  user: { login: 'ayse' },
  base: { ref: 'main', sha: 'b'.repeat(40) },
  head: { ref: 'feature/x', sha: 'c'.repeat(40) },
};

beforeEach(() => {
  calls = [];
  vi.stubEnv('GITHUB_TOKEN', '');
  vi.stubEnv('GH_TOKEN', '');
  vi.stubEnv('REVIEWIST_GITHUB_HOSTS', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchPrInfo', () => {
  it('başarı: tek istek, başlıklar, alanlar', async () => {
    vi.stubEnv('GITHUB_TOKEN', TOKEN);
    stubFetch(() => json(pull));
    const r = await fetchPrInfo(parseRemoteSpec('https://github.com/acme/shop/pull/7'));
    expect(r).toEqual({
      ok: true,
      info: {
        title: 'Sipariş servisi',
        body: 'Açıklama **md**',
        author: 'ayse',
        baseRef: 'main',
        baseSha: 'b'.repeat(40),
        headRef: 'feature/x',
        headSha: 'c'.repeat(40),
        htmlUrl: 'https://github.com/acme/shop/pull/7',
      },
    });
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c?.url).toBe('https://api.github.com/repos/acme/shop/pulls/7');
    expect(c?.headers.accept).toBe('application/vnd.github+json');
    expect(c?.headers['x-github-api-version']).toBe('2022-11-28');
    expect(c?.headers['user-agent']).toBe('reviewist');
    expect(c?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(c?.redirect).not.toBe('follow');
  });

  it('token yoksa Authorization başlığı yok', async () => {
    stubFetch(() => json(pull));
    const r = await fetchPrInfo(parseRemoteSpec('acme/shop#7'));
    expect(r.ok).toBe(true);
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it('401 / 403 / 404 / rate limit: Türkçe yönlendirici neden, token sızmaz', async () => {
    vi.stubEnv('GITHUB_TOKEN', TOKEN);
    const remote = parseRemoteSpec('https://github.com/acme/shop/pull/7');
    const cases: [Response, RegExp][] = [
      [json({ message: `Bad credentials ${TOKEN}` }, 401), /token geçersiz/],
      [json({ message: 'Resource not accessible' }, 403), /okuma izni/],
      [json({ message: 'Not Found' }, 404), /PR bulunamadı \(404\): acme\/shop#7/],
      [json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) }), /istek sınırı aşıldı; sınır saat \d{2}:\d{2}/],
      [json({}, 500), /HTTP 500/],
      [new Response('', { status: 301, headers: { location: 'https://evil.example/' } }), /yönlendirme/],
    ];
    for (const [res, re] of cases) {
      stubFetch(() => res.clone());
      const r = await fetchPrInfo(remote);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toMatch(re);
        expect(r.reason).not.toContain(TOKEN);
      }
    }
  });

  it('token yokken 404: özel depo için GITHUB_TOKEN önerilir', async () => {
    stubFetch(() => json({ message: 'Not Found' }, 404));
    const r = await fetchPrInfo(parseRemoteSpec('acme/shop#7'));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('GITHUB_TOKEN');
  });

  it('ağ hatası ve çıkış bekçisi engeli fırlatmaz', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed', { cause: new Error(`getaddrinfo ENOTFOUND ${TOKEN}`) });
    });
    vi.stubEnv('GITHUB_TOKEN', TOKEN);
    const r1 = await fetchPrInfo(parseRemoteSpec('acme/shop#7'));
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.reason).toMatch(/bağlanılamadı/);
      expect(r1.reason).not.toContain(TOKEN);
    }
    stubFetch(() => {
      throw new TypeError('fetch failed', { cause: new EgressBlockedError('api.github.com:443') });
    });
    const r2 = await fetchPrInfo(parseRemoteSpec('acme/shop#7'));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/çıkış bekçisi/);
  });

  it('beklenmeyen yanıt biçimi', async () => {
    stubFetch(() => json({ title: 'x' }));
    const r = await fetchPrInfo(parseRemoteSpec('acme/shop#7'));
    expect(r).toMatchObject({ ok: false });
  });

  it('güvenilmeyen sunucuda fetch HİÇ çağrılmaz; token gönderilmez', async () => {
    vi.stubEnv('GITHUB_TOKEN', TOKEN);
    const spy = vi.fn(() => json(pull));
    vi.stubGlobal('fetch', spy);
    for (const u of ['https://github.com.evil.example/acme/shop/pull/7', 'https://ghe.example/acme/shop/pull/7']) {
      const r = await fetchPrInfo(parseRemoteSpec(u));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toContain('REVIEWIST_GITHUB_HOSTS');
        expect(r.reason).not.toContain(TOKEN);
      }
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('güvenilir GHE sunucusu: API /api/v3, token gönderilir', async () => {
    vi.stubEnv('GITHUB_TOKEN', TOKEN);
    vi.stubEnv('REVIEWIST_GITHUB_HOSTS', 'ghe.example');
    stubFetch(() => json(pull));
    const r = await fetchPrInfo(parseRemoteSpec('https://ghe.example/acme/shop/pull/7'));
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe('https://ghe.example/api/v3/repos/acme/shop/pulls/7');
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('depo adresi (PR yok) ve yerel test deposu: istek yapılmaz', async () => {
    const spy = vi.fn(() => json(pull));
    vi.stubGlobal('fetch', spy);
    expect((await fetchPrInfo(parseRemoteSpec('acme/shop'))).ok).toBe(false);
    vi.stubEnv('REVIEWIST_ALLOW_FILE_REMOTE', '1');
    expect((await fetchPrInfo(parseRemoteSpec(`${process.cwd()}#3`))).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

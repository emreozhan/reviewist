import { afterEach, describe, expect, it, vi } from 'vitest';
import { S, T } from '../mock/ids';
import { PATHS as P } from '../mock/samplePaths';
import { sampleReview } from '../mock/sampleReview';
import { realApi } from './api';
import { isUnsupportedEndpoint } from './apiTypes';
import { fromLocation, needsLocate, resolveLocal, tabLabelFor, toOpenSpec } from './navTarget';
import { buildIndex } from './reviewIndex';

const index = buildIndex(sampleReview);

describe('hedef çözümleme (ReviewModel → sekme)', () => {
  it('diff içi metot: dosyası ve yeni aralığı', () => {
    const t = resolveLocal(index, S.pgCharge);
    expect(t).toMatchObject({ path: P.paymentGateway, inDiff: true, side: 'new', typeId: T.PG });
    expect(t?.line).toBeGreaterThan(0);
    expect(needsLocate(t)).toBe(false);
    expect(toOpenSpec(index, t!)).toMatchObject({ label: 'PaymentGateway', crumb: 'PaymentGateway.charge()' });
  });

  it('diff dışı metot: graf düğümünün aralığı (Kaynak sekmesi)', () => {
    const t = resolveLocal(index, S.emailSend);
    expect(t).toMatchObject({ path: P.emailNotifier, inDiff: false, side: 'new' });
    expect(t?.line).toBeGreaterThan(0);
    expect(tabLabelFor(index, P.emailNotifier, T.EMAIL)).toBe('EmailNotifier');
  });

  it('aralıksız düğüm ve bilinmeyen sembol sunucuya sorulur', () => {
    expect(needsLocate(resolveLocal(index, T.MT))).toBe(true);
    expect(needsLocate(resolveLocal(index, 'org.yok.Bilinmez#x()'))).toBe(true);
  });

  it('çağrı yeri ipucu dosyayı ve satırı belirler', () => {
    expect(resolveLocal(index, S.refCompensate, { file: P.refundService, line: 12, callSite: true })).toMatchObject({ path: P.refundService, line: 12, inDiff: false, callSite: true });
  });

  it('/locate sonucu: diff içi dosyada yeni taraf diff görünümüne gider', () => {
    const t = fromLocation(index, { id: 'x', kind: 'method', name: 'x', path: P.placeOrder, side: 'new', range: { startLine: 3, endLine: 9 }, inDiff: true });
    expect(t).toMatchObject({ inDiff: true, line: 3, endLine: 9 });
    const old = fromLocation(index, { id: 'y', kind: 'method', name: 'y', path: P.legacyFormatter, side: 'old', range: { startLine: 5, endLine: 6 }, inDiff: true });
    expect(old.inDiff).toBe(false);
  });
});

describe('kod gezinme uçlarının yokluğu', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown, json = true) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(json ? JSON.stringify(body) : String(body), { status, headers: { 'content-type': json ? 'application/json' : 'text/plain' } })));

  it('sunucunun "API uç noktası bulunamadı" ve gövdesiz 404/405 yanıtı: uç yok', async () => {
    respond(404, { error: 'API uç noktası bulunamadı.', detail: 'GET /api/reviews/r/outline' });
    const e1 = await realApi.getOutline('r', 'A.java', 'new').catch((e: unknown) => e);
    expect(isUnsupportedEndpoint(e1)).toBe(true);
    respond(405, 'Method Not Allowed', false);
    const e2 = await realApi.locate('r', 'a.B#c()').catch((e: unknown) => e);
    expect(isUnsupportedEndpoint(e2)).toBe(true);
  });

  it('uç varken "bulunamadı" 404\'ü uç yokluğu sayılmaz; istek adresi doğru kodlanır', async () => {
    respond(404, { error: 'Sembol bulunamadı.' });
    const e = await realApi.locate('r 1', 'a.B#c(int,String)').catch((x: unknown) => x);
    expect(isUnsupportedEndpoint(e)).toBe(false);
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/reviews/r%201/locate?id=a.B%23c(int%2CString)');
  });
});

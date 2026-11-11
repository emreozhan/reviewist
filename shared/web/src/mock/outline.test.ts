import { describe, expect, it } from 'vitest';
import { S, T } from './ids';
import { maskJava, mockLocate, mockOutline } from './outline';
import { sampleFiles } from './sampleFiles';
import { PATHS as P } from './samplePaths';

function refAt(path: string, needle: string, name: string) {
  const outline = mockOutline(path, 'new');
  const lines = sampleFiles[path]?.new?.split('\n') ?? [];
  const li = lines.findIndex((l) => l.includes(needle));
  const col = (lines[li] ?? '').indexOf(name, (lines[li] ?? '').indexOf(needle));
  return outline?.refs.find((r) => r.line === li + 1 && r.startCol === col);
}

describe('mock outline/locate', () => {
  it('yorum ve metinleri aynı uzunlukta örter', () => {
    expect(maskJava(['a = "x(y)"; // b()', '/* c() */ d();'])).toEqual(['a = "    ";       ', '          d();']);
  });

  it('bildirim kimlikleri ReviewModel biçimiyle aynı, değişenlerin durumu dolu', () => {
    const o = mockOutline(P.placeOrder, 'new');
    expect(o?.inDiff).toBe(true);
    expect(o?.packageName).toBe('com.shop.application');
    const ids = o?.decls.map((d) => d.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining([T.POS, S.posCtor, S.posPlace, `${T.POS}#payments`]));
    const place = o?.decls.find((d) => d.id === S.posPlace);
    expect(place?.status).toBe('modified');
    const lines = sampleFiles[P.placeOrder]?.new?.split('\n') ?? [];
    expect(lines[(place?.nameLine ?? 0) - 1]?.slice(place?.nameStartCol, place?.nameEndCol)).toBe('place');
  });

  it("payments.charge(...) alanın tipine göre PaymentGateway#charge'a çözülür", () => {
    const ref = refAt(P.placeOrder, 'payments.charge(', 'charge');
    expect(ref).toMatchObject({ kind: 'call', targets: [S.pgCharge], confidence: 'exact' });
  });

  it('soyut metoda niteleyicisiz çağrı alt tip override\'larını da hedefler', () => {
    const ref = refAt(P.notifier, 'send(event.recipient()', 'send');
    expect(ref?.targets).toEqual(expect.arrayContaining([S.anSend, S.emailSend, S.smsSend, S.pushSend]));
    expect(ref?.confidence).toBe('likely');
  });

  it('kurucu ve tip referansları', () => {
    expect(refAt(P.paymentResult, 'return new PaymentResult(transactionId', 'PaymentResult')).toMatchObject({ kind: 'constructor' });
    expect(refAt(P.placeOrder, 'private final PaymentGateway payments', 'PaymentGateway')).toMatchObject({ kind: 'type', targets: [T.PG] });
  });

  it('locate: diff dışı ve silinmiş semboller', () => {
    expect(mockLocate(S.emailSend)).toMatchObject({ path: P.emailNotifier, side: 'new', inDiff: false, typeId: T.EMAIL });
    expect(mockLocate(S.lmfFormat)).toMatchObject({ path: P.legacyFormatter, side: 'old', inDiff: true });
    expect(mockLocate('com.yok.Bilinmeyen#x()')).toBeNull();
  });

  it('içerik yoksa outline null; Java dışında boş', () => {
    expect(mockOutline('yok/Yok.java', 'new')).toBeNull();
    expect(mockOutline(P.pom, 'new')).toMatchObject({ decls: [], refs: [] });
  });
});

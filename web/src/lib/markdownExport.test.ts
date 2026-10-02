import { describe, expect, it } from 'vitest';
import { S } from '../mock/ids';
import { PATHS } from '../mock/samplePaths';
import { sampleReview } from '../mock/sampleReview';
import { buildMarkdown } from './markdownExport';
import { fileNoteKey, loadState, saveState, storageKey, symbolNoteKey } from './persistence';
import type { KeyValueStorage } from './persistence';
import { buildIndex } from './reviewIndex';

const index = buildIndex(sampleReview);

describe('buildMarkdown', () => {
  it('notları dosya başlıkları altında, sembol etiketiyle listeler', () => {
    const md = buildMarkdown(sampleReview, index, {
      seen: { [PATHS.paymentGateway]: true },
      notes: { [symbolNoteKey(S.moneyEquals)]: 'hashCode da güncellenmeli', [fileNoteKey(PATHS.pom)]: 'Sürüm notlarına bak' },
    });
    expect(md).toContain(`# Review notları: ${sampleReview.source.title}`);
    expect(md).toContain(`- İlerleme: 1/${sampleReview.files.length} dosya görüldü`);
    expect(md).toContain(`### \`${PATHS.money}\``);
    expect(md).toContain('**`Money.equals()`**');
    expect(md).toContain('  hashCode da güncellenmeli');
    expect(md).toContain('> Sürüm notlarına bak');
    expect(md).toContain('## Dikkat gerektiren bulgular');
    expect(md).toContain(`- [ ] \`${PATHS.stripe}\``);
    expect(md).not.toContain(`- [ ] \`${PATHS.paymentGateway}\``);
  });

  it('not yoksa bunu belirtir ve boş notları atlar', () => {
    const md = buildMarkdown(sampleReview, index, { seen: {}, notes: { [symbolNoteKey(S.pgCharge)]: '   ' } });
    expect(md).toContain('_Henüz not yok._');
  });
});

describe('kalıcılık', () => {
  function memory(): KeyValueStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('anahtar head sha üzerinden kurulur', () => {
    expect(storageKey(sampleReview)).toBe(`reviewist:${sampleReview.source.headSha}`);
    expect(storageKey({ id: 'x', source: { ...sampleReview.source, headSha: undefined } })).toBe('reviewist:x');
  });

  it('kaydeder, boş notları ve false değerleri atar, geri okur', () => {
    const s = memory();
    saveState('k', { seen: { a: true, b: false }, notes: { n1: 'x', n2: ' ' } }, s);
    expect(JSON.parse(s.data.get('k') ?? '{}')).toEqual({ seen: { a: true }, notes: { n1: 'x' } });
    expect(loadState('k', s)).toEqual({ seen: { a: true }, notes: { n1: 'x' } });
  });

  it('bozuk veri ve hata fırlatan depolamada güvenle boş döner', () => {
    const s = memory();
    s.data.set('k', '{bozuk');
    expect(loadState('k', s)).toEqual({ seen: {}, notes: {} });
    s.data.set('k', JSON.stringify({ seen: { a: 'evet' }, notes: [] }));
    expect(loadState('k', s)).toEqual({ seen: {}, notes: {} });
    const throwing: KeyValueStorage = { getItem: () => { throw new Error('yasak'); }, setItem: () => { throw new Error('dolu'); } };
    expect(loadState('k', throwing)).toEqual({ seen: {}, notes: {} });
    expect(saveState('k', { seen: {}, notes: {} }, throwing)).toBe(false);
    expect(loadState('k', null)).toEqual({ seen: {}, notes: {} });
  });
});

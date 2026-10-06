import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from './persistence';
import { forgetReviewState, rememberReviewKeys, REVIEW_KEYS_KEY } from './reviewKeys';

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('inceleme silinince tarayıcı kayıtları', () => {
  it('not edilen anahtarlar silinir; düzen, son depolar ve başka incelemeler kalır', () => {
    const s = memory();
    for (const k of ['reviewist:sk1', 'reviewist:tabs:sk1', 'reviewist:sk2', 'reviewist:tabs:sk2', 'reviewist:layout', 'reviewist:recentRepos']) s.setItem(k, '{}');
    rememberReviewKeys('rv1', { progress: 'reviewist:sk1', tabs: 'reviewist:tabs:sk1' }, s);
    rememberReviewKeys('rv2', { progress: 'reviewist:sk2', tabs: 'reviewist:tabs:sk2' }, s);
    expect(forgetReviewState('rv1', undefined, s)).toEqual(['reviewist:sk1', 'reviewist:tabs:sk1']);
    expect([...s.data.keys()].sort()).toEqual(['reviewist:layout', 'reviewist:recentRepos', 'reviewist:reviewKeys', 'reviewist:sk2', 'reviewist:tabs:sk2']);
    expect(JSON.parse(s.data.get(REVIEW_KEYS_KEY) ?? '{}')).toEqual({ rv2: { progress: 'reviewist:sk2', tabs: 'reviewist:tabs:sk2' } });
  });

  it('önbellekteki modelden gelen anahtarlar da kullanılır; genel kayıtlar asla silinmez', () => {
    const s = memory();
    s.setItem('reviewist:sk3', '{}');
    s.setItem('reviewist:layout', '{}');
    expect(forgetReviewState('rv3', { progress: 'reviewist:sk3', tabs: 'reviewist:layout' }, s)).toEqual(['reviewist:sk3']);
    expect(s.data.has('reviewist:layout')).toBe(true);
  });

  it('bilinmeyen inceleme ya da depolama yok: hiçbir şey silinmez', () => {
    const s = memory();
    s.setItem('reviewist:x', '{}');
    expect(forgetReviewState('yok', undefined, s)).toEqual([]);
    expect(forgetReviewState('yok', undefined, null)).toEqual([]);
    expect(s.data.has('reviewist:x')).toBe(true);
  });
});

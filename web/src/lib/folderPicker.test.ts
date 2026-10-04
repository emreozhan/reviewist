import { describe, expect, it } from 'vitest';
import type { FsListing } from '../../../src/shared/types';
import { folderStatus } from '../features/source/folderPicker/folderStatus';
import { baseName, pathCrumbs, pathKey, samePath } from './fsPath';
import type { KeyValueStorage } from './persistence';
import { loadRecentRepos, MAX_RECENT_REPOS, pushRecentRepo, RECENT_REPOS_KEY, rememberRepo, repoPathOf } from './recentRepos';
import { typeAheadIndex } from './typeAhead';

describe('pathCrumbs', () => {
  it('Windows yolu', () => {
    expect(pathCrumbs('C:\\a\\b')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'a', path: 'C:\\a' },
      { label: 'b', path: 'C:\\a\\b' },
    ]);
  });

  it('Windows: ileri eğik çizgi, sondaki ayırıcı, sürücü kökü', () => {
    expect(pathCrumbs('d:/projeler/shop/')).toEqual([
      { label: 'D:', path: 'd:\\' },
      { label: 'projeler', path: 'd:\\projeler' },
      { label: 'shop', path: 'd:\\projeler\\shop' },
    ]);
    expect(pathCrumbs('C:\\')).toEqual([{ label: 'C:', path: 'C:\\' }]);
  });

  it('UNC yolu kökü tek kırıntı', () => {
    expect(pathCrumbs('\\\\sunucu\\pay\\x')).toEqual([
      { label: '\\\\sunucu\\pay', path: '\\\\sunucu\\pay' },
      { label: 'x', path: '\\\\sunucu\\pay\\x' },
    ]);
  });

  it('POSIX yolu', () => {
    expect(pathCrumbs('/home/ayşe/işler/')).toEqual([
      { label: '/', path: '/' },
      { label: 'home', path: '/home' },
      { label: 'ayşe', path: '/home/ayşe' },
      { label: 'işler', path: '/home/ayşe/işler' },
    ]);
    expect(pathCrumbs('/')).toEqual([{ label: '/', path: '/' }]);
    expect(pathCrumbs('')).toEqual([]);
  });

  it('yol karşılaştırma ve ad', () => {
    expect(samePath('C:\\Work\\Shop\\', 'c:/work/shop')).toBe(true);
    expect(samePath('/home/A', '/home/a')).toBe(false);
    expect(pathKey('C:\\')).toBe('c:\\');
    expect(pathKey('/')).toBe('/');
    expect(baseName('C:\\a\\proje')).toBe('proje');
    expect(baseName('/')).toBe('/');
  });
});

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('son kullanılan repolar', () => {
  it('başa ekler, tekrar etmez (Windows harf/ayırıcı duyarsız), en çok 8', () => {
    let list: string[] = [];
    for (let i = 0; i < 10; i++) list = pushRecentRepo(list, `C:\\r${i}`);
    expect(list).toHaveLength(MAX_RECENT_REPOS);
    expect(list[0]).toBe('C:\\r9');
    expect(list).not.toContain('C:\\r1');
    list = pushRecentRepo(list, 'c:/R5/');
    expect(list[0]).toBe('c:/R5/');
    expect(list.filter((p) => pathKey(p) === 'c:\\r5')).toHaveLength(1);
    expect(list).toHaveLength(MAX_RECENT_REPOS);
    expect(pushRecentRepo(['/a'], '  ')).toEqual(['/a']);
  });

  it('localStorage: kaydet/oku, bozuk kayıt ve hata yutulur', () => {
    const s = memoryStorage();
    rememberRepo('/x', s);
    rememberRepo('/y', s);
    expect(rememberRepo('/x', s)).toEqual(['/x', '/y']);
    expect(loadRecentRepos(s)).toEqual(['/x', '/y']);
    expect(loadRecentRepos(memoryStorage({ [RECENT_REPOS_KEY]: '{bozuk' }))).toEqual([]);
    expect(loadRecentRepos(memoryStorage({ [RECENT_REPOS_KEY]: JSON.stringify(['/a', 3, '/a', '/b']) }))).toEqual(['/a', '/b']);
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('erişim yok');
      },
      setItem: () => {
        throw new Error('kota');
      },
    };
    expect(rememberRepo('/z', throwing)).toEqual(['/z']);
    expect(loadRecentRepos(null)).toEqual([]);
  });

  it('istekten repo yolu', () => {
    expect(repoPathOf({ kind: 'git', repoPath: '/r', base: 'a', head: 'b' })).toBe('/r');
    expect(repoPathOf({ kind: 'github', url: 'u' })).toBeUndefined();
    expect(repoPathOf({ kind: 'patch', text: 't', repoPath: '/p' })).toBe('/p');
  });
});

describe('typeAheadIndex', () => {
  const labels = ['..', 'api', 'Ağaç', 'billing', 'İzmir', 'ılık', 'shop', 'shop-admin', 'şube'];

  it('önek eşleşmesi, büyük/küçük harf duyarsız (Türkçe)', () => {
    expect(typeAheadIndex(labels, 'b', -1)).toBe(3);
    expect(typeAheadIndex(labels, 'i', -1)).toBe(4); // 'İzmir' → 'izmir'
    expect(typeAheadIndex(labels, 'ı', -1)).toBe(5);
    expect(typeAheadIndex(labels, 'Ş', -1)).toBe(8);
    expect(typeAheadIndex(labels, 'x', 2)).toBe(-1);
    expect(typeAheadIndex([], 'a', 0)).toBe(-1);
  });

  it('tek harf sonraki eşleşmeye döner, uzun sorgu geçerli öğede kalır', () => {
    expect(typeAheadIndex(labels, 'a', -1)).toBe(1);
    expect(typeAheadIndex(labels, 'a', 1)).toBe(2);
    expect(typeAheadIndex(labels, 'a', 2)).toBe(1); // başa sarar
    expect(typeAheadIndex(labels, 'sh', 6)).toBe(6);
    expect(typeAheadIndex(labels, 'shop-', 6)).toBe(7);
    expect(typeAheadIndex(labels, 'ss', 6)).toBe(7); // aynı harf tekrarı = döngü
  });
});

describe('folderStatus', () => {
  const base: FsListing = { path: 'C:\\r', isGitRepo: false, entries: [], roots: [], truncated: false };
  const entry = (isGitRepo: boolean) => ({ name: 'x', path: 'C:\\r\\x', isGitRepo, hidden: false });

  it('seçili klasör ve gezilen klasör', () => {
    expect(folderStatus(base)).toEqual({ kind: 'plain', path: 'C:\\r' });
    expect(folderStatus({ ...base, isGitRepo: true })).toEqual({ kind: 'repo', path: 'C:\\r' });
    expect(folderStatus({ ...base, repoRoot: 'C:\\' })).toEqual({ kind: 'inside', path: 'C:\\r', repoRoot: 'C:\\' });
    expect(folderStatus(base, entry(true))).toEqual({ kind: 'repo', path: 'C:\\r\\x' });
    expect(folderStatus({ ...base, isGitRepo: true }, entry(false))).toEqual({ kind: 'inside', path: 'C:\\r\\x', repoRoot: 'C:\\r' });
    expect(folderStatus(base, entry(false))).toEqual({ kind: 'plain', path: 'C:\\r\\x' });
  });
});

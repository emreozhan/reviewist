import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, FsListing } from '../shared/types.js';
import { createApp } from './app.js';
import { compareNames, isHiddenName, listDirectory, listRoots, normalizeRequestPath } from './fsList.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'reviewist-fs-'));
  for (const d of ['zeta', 'çay', 'Ağaç', 'ılık', 'ibik', 'şeker', 'Ödev', 'cam', 'sabun', 'ufuk', 'üzüm', 'v10', 'v2']) {
    mkdirSync(join(root, 'sirala', d), { recursive: true });
  }
  // .git klasörü (normal depo) ve .git dosyası (worktree/submodule)
  mkdirSync(join(root, 'repos', 'depo-klasor', '.git'), { recursive: true });
  mkdirSync(join(root, 'repos', 'depo-klasor', 'src', 'main'), { recursive: true });
  mkdirSync(join(root, 'repos', 'calisma-agaci'), { recursive: true });
  writeFileSync(join(root, 'repos', 'calisma-agaci', '.git'), 'gitdir: ../depo-klasor/.git/worktrees/x\n');
  mkdirSync(join(root, 'repos', 'duz-klasor'), { recursive: true });
  writeFileSync(join(root, 'repos', 'not.txt'), 'dosya listelenmez');
  // gizli
  mkdirSync(join(root, 'gizli', '.config'), { recursive: true });
  mkdirSync(join(root, 'gizli', 'gorunur'), { recursive: true });
  if (process.platform === 'win32') mkdirSync(join(root, 'gizli', '$Recycle.Bin'), { recursive: true });
  // klasöre işaret eden bağ (Windows'ta yönetici gerektirmeyen junction)
  mkdirSync(join(root, 'bag', 'hedef'), { recursive: true });
  symlinkSync(join(root, 'bag', 'hedef'), join(root, 'bag', 'baglanti'), 'junction');
  writeFileSync(join(root, 'bag', 'dosya.txt'), 'x');
  // çok girdi
  for (let i = 0; i < 25; i++) mkdirSync(join(root, 'cok', `k${String(i).padStart(2, '0')}`), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const names = (l: FsListing): string[] => l.entries.map((e) => e.name);

describe('listDirectory', () => {
  it('yalnız klasörleri listeler; .git klasör ve dosya olarak tanınır', async () => {
    const l = await listDirectory(join(root, 'repos'));
    expect(l.path).toBe(join(root, 'repos'));
    expect(l.parent).toBe(root);
    expect(names(l)).toEqual(['calisma-agaci', 'depo-klasor', 'duz-klasor']);
    expect(l.entries.map((e) => e.isGitRepo)).toEqual([true, true, false]);
    expect(l.entries[0]?.path).toBe(join(root, 'repos', 'calisma-agaci'));
    expect(l.isGitRepo).toBe(false);
    expect(l.repoRoot).toBeUndefined();
    expect(l.truncated).toBe(false);
  });

  it('depo kökü ve depo içindeki alt klasör için repoRoot', async () => {
    const repo = join(root, 'repos', 'depo-klasor');
    const self = await listDirectory(repo);
    expect(self.isGitRepo).toBe(true);
    expect(self.repoRoot).toBeUndefined();
    const sub = await listDirectory(join(repo, 'src', 'main'));
    expect(sub.isGitRepo).toBe(false);
    expect(sub.repoRoot).toBe(repo);
  });

  it('Türkçe yerel duyarlı ve sayı bilinçli sıralama', async () => {
    const l = await listDirectory(join(root, 'sirala'));
    expect(names(l)).toEqual(['Ağaç', 'cam', 'çay', 'ılık', 'ibik', 'Ödev', 'sabun', 'şeker', 'ufuk', 'üzüm', 'v2', 'v10', 'zeta']);
  });

  it('gizli klasörler varsayılan olarak gizlenir, hidden ile görünür', async () => {
    const dir = join(root, 'gizli');
    expect(names(await listDirectory(dir))).toEqual(['gorunur']);
    const all = await listDirectory(dir, { hidden: true });
    const expected = process.platform === 'win32' ? ['.config', '$Recycle.Bin', 'gorunur'] : ['.config', 'gorunur'];
    expect([...names(all)].sort()).toEqual([...expected].sort());
    expect(all.entries.find((e) => e.name === '.config')?.hidden).toBe(true);
    expect(all.entries.find((e) => e.name === 'gorunur')?.hidden).toBe(false);
  });

  it('klasöre işaret eden bağ listelenir, dosya listelenmez', async () => {
    expect(names(await listDirectory(join(root, 'bag')))).toEqual(['baglanti', 'hedef']);
  });

  it('en çok N girdi; fazlası truncated', async () => {
    const l = await listDirectory(join(root, 'cok'), { maxEntries: 10 });
    expect(l.entries).toHaveLength(10);
    expect(l.truncated).toBe(true);
    expect(names(l)[0]).toBe('k00');
    expect((await listDirectory(join(root, 'cok'))).truncated).toBe(false);
  });

  it('boş yol ev dizini; kökte parent yok', async () => {
    const l = await listDirectory('', { homeDir: join(root, 'repos') });
    expect(l.path).toBe(join(root, 'repos'));
    const top = await listDirectory(parse(root).root);
    expect(top.parent).toBeUndefined();
  });

  it('kısayollar: ev, çalışma dizini, sürücü/kök; tekrar yok', async () => {
    const roots = await listRoots({ home: homedir(), cwd: join(root, 'repos') });
    expect(roots[0]).toEqual({ label: 'Ev', path: homedir(), kind: 'home' });
    expect(roots).toContainEqual({ label: 'Çalışma dizini', path: join(root, 'repos'), kind: 'cwd' });
    const drives = roots.filter((r) => r.kind === 'drive');
    expect(drives.length).toBeGreaterThan(0);
    if (process.platform === 'win32') expect(drives.some((d) => d.path.toUpperCase() === `${parse(root).root.toUpperCase()}`)).toBe(true);
    else expect(drives[0]?.path).toBe('/');
    expect(new Set(roots.map((r) => r.path.toLowerCase())).size).toBe(roots.length);
  });

  it('yardımcılar', () => {
    expect(isHiddenName('.git')).toBe(true);
    expect(isHiddenName('AppData', 'win32')).toBe(true);
    expect(isHiddenName('AppData', 'linux')).toBe(false);
    expect(isHiddenName('src', 'win32')).toBe(false);
    expect(compareNames('ı', 'i')).toBeLessThan(0);
    expect(() => normalizeRequestPath('göreli/yol', homedir())).toThrow(/mutlak/);
    expect(() => normalizeRequestPath('\\\\sunucu\\pay', homedir())).toThrow(/Ağ yolları/);
    expect(() => normalizeRequestPath('//sunucu/pay', homedir())).toThrow(/Ağ yolları/);
    if (process.platform === 'win32') {
      expect(normalizeRequestPath('c:/Windows/../Users', homedir())).toBe('c:\\Users');
      expect(normalizeRequestPath('C:', homedir())).toBe('C:\\');
      expect(() => normalizeRequestPath('\\Users', homedir())).toThrow(/mutlak/);
    }
  });
});

describe('GET /api/fs/list', () => {
  const make = () => createApp({ defaultRepoPath: join(root, 'repos'), buildReview: async () => Promise.reject(new Error('kullanılmaz')) });
  const get = async (q: string, headers: Record<string, string> = {}) => await make().app.request(`/api/fs/list${q}`, { headers });

  it('200: listeleme ve kısayollarda çalışma dizini, ev', async () => {
    const res = await get(`?path=${encodeURIComponent(join(root, 'repos'))}`);
    expect(res.status).toBe(200);
    const l = (await res.json()) as FsListing;
    expect(l.entries.map((e) => e.name)).toEqual(['calisma-agaci', 'depo-klasor', 'duz-klasor']);
    expect(l.roots.some((r) => r.kind === 'cwd' && r.path === join(root, 'repos'))).toBe(true);
    expect(l.roots.some((r) => r.kind === 'home' && r.path === homedir())).toBe(true);
  });

  it('path verilmezse ev dizini', async () => {
    const l = (await (await get('')).json()) as FsListing;
    expect(l.path).toBe(homedir());
  });

  it('hidden=1 gizlileri gösterir', async () => {
    const q = `?path=${encodeURIComponent(join(root, 'gizli'))}`;
    expect(((await (await get(q)).json()) as FsListing).entries.map((e) => e.name)).toEqual(['gorunur']);
    expect(((await (await get(`${q}&hidden=1`)).json()) as FsListing).entries.some((e) => e.name === '.config')).toBe(true);
  });

  it('400 göreli yol (field path), 404 olmayan klasör ve dosya, Türkçe', async () => {
    const rel = await get('?path=src');
    expect(rel.status).toBe(400);
    const relBody = (await rel.json()) as ApiError;
    expect(relBody.field).toBe('path');
    expect(relBody.error).toContain('mutlak');

    const missing = await get(`?path=${encodeURIComponent(join(root, 'yok-boyle-bir-klasor'))}`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ApiError).error).toContain('Klasör bulunamadı');

    const file = await get(`?path=${encodeURIComponent(join(root, 'repos', 'not.txt'))}`);
    expect(file.status).toBe(404);
    expect(((await file.json()) as ApiError).error).toContain('klasör değil');

    const unc = await get(`?path=${encodeURIComponent('\\\\evil\\share')}`);
    expect(unc.status).toBe(400);
  });

  it('güvenlik: yabancı Host ve başka siteden istek reddedilir', async () => {
    const q = `?path=${encodeURIComponent(dirname(root))}`;
    const host = await make().app.request(`http://evil.example/api/fs/list${q}`, { headers: { host: 'evil.example' } });
    expect(host.status).toBe(403);
    expect((await get(q, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get(q, { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });
});

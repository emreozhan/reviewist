import { describe, expect, it } from 'vitest';
import type { GitRefs } from '../../../../src/shared/types';
import { buildRefOptions, buildRefRows, describeRef, filterRefOptions, isKnownRef, suggestHead } from './refOptions';

const refs: GitRefs = {
  repoPath: 'C:/repo',
  currentBranch: 'main',
  defaultBase: 'main',
  branches: ['feature/ai-refactor', 'feature/small-fix', 'main'],
  remoteBranches: ['origin/main'],
  tags: ['v1.0'],
  recentCommits: [{ sha: '08c678d24b95ed0864ab3933d9e6c973af9a325e', subject: 'İlk', author: 'A', date: '2026-01-05T10:00:00Z' }],
};

describe('isKnownRef', () => {
  it('başka repodan kalan dal adını tanımaz', () => {
    expect(isKnownRef(refs, 'master')).toBe(false);
    expect(isKnownRef(refs, '')).toBe(false);
  });

  it('dal, uzak dal, etiket, HEAD ifadesi ve SHA kabul eder', () => {
    for (const v of ['main', 'origin/main', 'v1.0', 'HEAD', 'HEAD~2', '08c678d']) expect(isKnownRef(refs, v)).toBe(true);
  });
});

describe('suggestHead', () => {
  it('geçerli dal tabanla aynıysa tabandan farklı en güncel dalı önerir', () => {
    expect(suggestHead({ ...refs, recentBranches: ['main', 'feature/small-fix', 'feature/ai-refactor'] }, 'main')).toBe('feature/small-fix');
  });

  it('geçerli dal tabandan farklıysa onu önerir', () => {
    expect(suggestHead({ ...refs, currentBranch: 'feature/ai-refactor' }, 'main')).toBe('feature/ai-refactor');
  });

  it('recentBranches yoksa alfabetik listeden seçer', () => {
    expect(suggestHead(refs, 'main')).toBe('feature/ai-refactor');
  });
});

describe('filterRefOptions', () => {
  it('boş sorguda tüm ref grupları listelenir', () => {
    const all = filterRefOptions(buildRefOptions(refs), '');
    expect(all.map((o) => o.group)).toEqual(['Dallar', 'Dallar', 'Dallar', 'Uzak dallar', 'Etiketler', 'Son commitler']);
  });

  it('yazılan metinle süzer', () => {
    expect(filterRefOptions(buildRefOptions(refs), 'feat').map((o) => o.value)).toEqual(['feature/ai-refactor', 'feature/small-fix']);
  });
});

describe('buildRefRows', () => {
  it('sorgu yokken boşaltma seçeneği ve tüm refler', () => {
    const rows = buildRefRows(refs, '', 'HEAD (varsayılan)');
    expect(rows[0]).toMatchObject({ special: 'empty', value: '' });
    expect(rows.filter((r) => !r.special).map((r) => r.value)).toContain('feature/ai-refactor');
  });

  it('birebir eşleşme yoksa yazılanı olduğu gibi kullan satırı başa gelir', () => {
    const rows = buildRefRows(refs, 'HEAD~3');
    expect(rows[0]).toMatchObject({ special: 'custom', value: 'HEAD~3' });
  });

  it('birebir eşleşmede serbest satır eklenmez', () => {
    expect(buildRefRows(refs, 'main').some((r) => r.special === 'custom')).toBe(false);
  });
});

describe('describeRef', () => {
  it('ref türünü ve commit konusunu bulur', () => {
    expect(describeRef(refs, 'main')).toEqual({ kind: 'branch', label: 'main' });
    expect(describeRef(refs, 'v1.0').kind).toBe('tag');
    expect(describeRef(refs, '08c678d')).toEqual({ kind: 'commit', label: '08c678d İlk' });
    expect(describeRef(refs, 'HEAD~2').kind).toBe('custom');
  });
});

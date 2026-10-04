import { describe, expect, it } from 'vitest';
import type { GitRefs } from '../../../../src/shared/types';
import { buildRefOptions, filterRefOptions, isKnownRef } from './refOptions';

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

describe('filterRefOptions', () => {
  it('boş sorguda tüm ref grupları listelenir', () => {
    const all = filterRefOptions(buildRefOptions(refs), '');
    expect(all.map((o) => o.group)).toEqual(['Dallar', 'Dallar', 'Dallar', 'Uzak dallar', 'Etiketler', 'Son commitler']);
  });

  it('yazılan metinle süzer', () => {
    expect(filterRefOptions(buildRefOptions(refs), 'feat').map((o) => o.value)).toEqual(['feature/ai-refactor', 'feature/small-fix']);
  });
});

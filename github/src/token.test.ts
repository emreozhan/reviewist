import { describe, expect, it } from 'vitest';
import { apiHostsAllowed, githubTokenConfigured, isTrustedHost, resolveGithubTokenFor, trustedGithubHosts } from './token.js';

describe('token: güvenilir sunucu kuralları', () => {
  it("ortam token'ı yalnız github.com ve REVIEWIST_GITHUB_HOSTS sunucularına gider", () => {
    const env: NodeJS.ProcessEnv = { GITHUB_TOKEN: 'gizli', REVIEWIST_GITHUB_HOSTS: '' };
    expect(resolveGithubTokenFor('github.com', undefined, env)).toEqual({ token: 'gizli' });
    expect(resolveGithubTokenFor('GitHub.com', undefined, env)).toEqual({ token: 'gizli' });
    expect(resolveGithubTokenFor('www.github.com', undefined, env)).toEqual({ token: 'gizli' });
    // Yapıştırılan yabancı adres: token gönderilmez, nedeni raporlanır
    expect(resolveGithubTokenFor('github.com.evil.example', undefined, env)).toEqual({ withheldEnv: 'GITHUB_TOKEN' });
    expect(resolveGithubTokenFor('git.sirket.com.tr', undefined, env)).toEqual({ withheldEnv: 'GITHUB_TOKEN' });
    expect(resolveGithubTokenFor('local', undefined, env)).toEqual({ withheldEnv: 'GITHUB_TOKEN' });

    const ghe: NodeJS.ProcessEnv = { GITHUB_TOKEN: 'gizli', REVIEWIST_GITHUB_HOSTS: 'git.sirket.com.tr, GHE.example;x.y' };
    expect(resolveGithubTokenFor('git.sirket.com.tr', undefined, ghe)).toEqual({ token: 'gizli' });
    expect(resolveGithubTokenFor('ghe.example', undefined, ghe)).toEqual({ token: 'gizli' });
    expect(resolveGithubTokenFor('ghe.example:8443', undefined, ghe)).toEqual({ token: 'gizli' });
    expect(resolveGithubTokenFor('other.example', undefined, ghe)).toEqual({ withheldEnv: 'GITHUB_TOKEN' });
    expect(trustedGithubHosts(ghe)).toEqual(new Set(['github.com', 'git.sirket.com.tr', 'ghe.example', 'x.y']));
  });

  it('token sırası: GITHUB_TOKEN → GH_TOKEN; özel ad listesi; boş değerler yok sayılır', () => {
    expect(resolveGithubTokenFor('github.com', undefined, { GH_TOKEN: 'gh' })).toEqual({ token: 'gh' });
    expect(resolveGithubTokenFor('github.com', undefined, { GH_TOKEN: 'gh', GITHUB_TOKEN: 'github' })).toEqual({ token: 'github' });
    expect(resolveGithubTokenFor('github.com', undefined, { GITHUB_TOKEN: '  ', GH_TOKEN: 'gh' })).toEqual({ token: 'gh' });
    expect(resolveGithubTokenFor('github.com', ['OZEL'], { OZEL: 'ozel', GITHUB_TOKEN: 'github' })).toEqual({ token: 'ozel' });
    expect(resolveGithubTokenFor('github.com', undefined, {})).toEqual({});
    expect(githubTokenConfigured(undefined, {})).toBe(false);
    expect(githubTokenConfigured(undefined, { GH_TOKEN: 'x' })).toBe(true);
    expect(githubTokenConfigured(['OZEL'], { GH_TOKEN: 'x' })).toBe(false);
  });

  it('isTrustedHost', () => {
    expect(isTrustedHost('github.com', {})).toBe(true);
    expect(isTrustedHost('api.github.com', {})).toBe(false);
    expect(isTrustedHost('evil.example', {})).toBe(false);
  });
});

describe('apiHostsAllowed', () => {
  it('api.github.com + güvenilir GHE sunucuları (port olmadan)', () => {
    expect(apiHostsAllowed({})).toEqual(['api.github.com']);
    expect(apiHostsAllowed({ REVIEWIST_GITHUB_HOSTS: 'ghe.example, git.sirket.com:8443' }).sort()).toEqual(
      ['api.github.com', 'ghe.example', 'git.sirket.com'].sort(),
    );
    // github.com'un kendisi API sunucusu değildir
    expect(apiHostsAllowed({ REVIEWIST_GITHUB_HOSTS: 'github.com' })).toEqual(['api.github.com']);
  });
});

/**
 * GitHub API token'ı (yalnız PR başlığı/taban dalı isteği için). Token ortam değişkeninden okunur ve YALNIZ güvenilir
 * sunuculara gönderilir: github.com + `REVIEWIST_GITHUB_HOSTS`. Aksi halde yapıştırılan herhangi bir adres
 * (ör. `github.com.evil.example`) GITHUB_TOKEN'ı ele geçirebilirdi. Kod getirme git ile yapılır; git kendi kimlik
 * bilgisi yardımcısını (credential helper / SSH anahtarı) kullanır, bu token'ı kullanmaz.
 */
import { hostnameOf } from './remote.js';

export const DEFAULT_TOKEN_ENVS = ['GITHUB_TOKEN', 'GH_TOKEN'] as const;

/** Ortam değişkenindeki token'ın gönderilebileceği ek sunucular (GitHub Enterprise): virgülle ayrılmış alan adları. */
export const TRUSTED_HOSTS_ENV = 'REVIEWIST_GITHUB_HOSTS';

/** Ortam token'ının gönderilebileceği (ve API çağrısı yapılabilecek) sunucular: github.com + REVIEWIST_GITHUB_HOSTS. */
export function trustedGithubHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const extra = (env[TRUSTED_HOSTS_ENV] ?? '')
    .split(/[\s,;]+/)
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  return new Set(['github.com', ...extra]);
}

/** Sunucu güvenilir listede mi (büyük/küçük harf duyarsız; `www.github.com` = `github.com`). */
export function isTrustedHost(host: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let h = host.trim().toLowerCase();
  if (h === 'www.github.com') h = 'github.com';
  const trusted = trustedGithubHosts(env);
  return trusted.has(h) || trusted.has(hostnameOf(h));
}

export interface ResolvedToken {
  token?: string;
  /** Ortamda token var ama sunucu güvenilir listede olmadığı için gönderilmedi: değişkenin adı. */
  withheldEnv?: string;
}

/** Belirli bir sunucu için kullanılacak token: ilk dolu ortam değişkeni, yalnız sunucu güvenilirse. */
export function resolveGithubTokenFor(
  host: string,
  envNames: readonly string[] = DEFAULT_TOKEN_ENVS,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedToken {
  for (const name of envNames) {
    const v = env[name]?.trim();
    if (!v) continue;
    return isTrustedHost(host, env) ? { token: v } : { withheldEnv: name };
  }
  return {};
}

/** Ortamda (verilen adlardan birinde) token tanımlı mı. */
export function githubTokenConfigured(
  envNames: readonly string[] = DEFAULT_TOKEN_ENVS,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envNames.some((n) => (env[n]?.trim() ?? '') !== '');
}

/**
 * Çıkış bekçisinin izin listesi: GitHub API sunucuları. github.com için `api.github.com`; güvenilir GHE sunucuları
 * için sunucunun kendisi (API `https://sunucu/api/v3`). Port kısmı atılır (bekçi sunucu adıyla karşılaştırır).
 */
export function apiHostsAllowed(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>(['api.github.com']);
  for (const h of trustedGithubHosts(env)) {
    if (h === 'github.com') continue;
    out.add(hostnameOf(h));
  }
  return [...out];
}

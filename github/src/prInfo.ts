/**
 * PR bilgisi: TEK bir GitHub REST isteği (`GET /repos/{o}/{r}/pulls/{n}`) ile başlık, açıklama, yazar ve taban/baş
 * dal adları. Kod git ile getirilir; bu istek başarısız olsa da inceleme devam eder (çağıran uyarıya çevirir).
 * Bu yüzden işlev FIRLATMAZ: `{ ok: false, reason }` döner. Token asla iletiye/ayrıntıya konmaz.
 */
import { z } from 'zod';
import { shortMessage } from '../../shared/src/sources/errors.js';
import type { RemoteSpec } from './remote.js';
import { DEFAULT_TOKEN_ENVS, isTrustedHost, resolveGithubTokenFor, TRUSTED_HOSTS_ENV } from './token.js';

export interface PrInfo {
  title: string;
  body?: string;
  author?: string;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  htmlUrl?: string;
}

export type PrInfoResult = { ok: true; info: PrInfo } | { ok: false; reason: string };

export interface FetchPrInfoOptions {
  /** Token için bakılacak ortam değişkenleri (varsayılan GITHUB_TOKEN, GH_TOKEN). */
  tokenEnvNames?: readonly string[];
  /** İstek zaman aşımı (ms). Varsayılan 20 sn. */
  timeoutMs?: number;
}

export const API_VERSION = '2022-11-28';
const USER_AGENT = 'reviewist';

const pullSchema = z.object({
  title: z.string(),
  body: z.string().nullable().optional(),
  html_url: z.string().optional(),
  user: z.object({ login: z.string() }).nullable().optional(),
  base: z.object({ ref: z.string().min(1), sha: z.string() }),
  head: z.object({ ref: z.string().min(1), sha: z.string() }),
});

function formatReset(resetEpochSec: number | undefined): string {
  if (resetEpochSec === undefined || !Number.isFinite(resetEpochSec)) return 'bir süre sonra';
  const d = new Date(resetEpochSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const mins = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 60000));
  return `saat ${hh}:${mm} civarında (yaklaşık ${mins} dk sonra)`;
}

async function readGithubMessage(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') {
      return parsed.message.slice(0, 200);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Hata zincirinde çıkış bekçisi engeli var mı (fetch `TypeError` içine `cause` olarak sarar). */
function isEgressBlocked(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e === 'object' && e !== null && 'code' in e && e.code === 'EREVIEWIST_EGRESS') return true;
    e = typeof e === 'object' && e !== null && 'cause' in e ? e.cause : undefined;
  }
  return false;
}

function hide(text: string, token: string | undefined): string {
  return token ? text.split(token).join('***') : text;
}

/** PR bilgisini alır; başarısızlıkta Türkçe, yönlendirici `reason` döner (fırlatmaz). */
export async function fetchPrInfo(remote: RemoteSpec, opts: FetchPrInfoOptions = {}): Promise<PrInfoResult> {
  const n = remote.prNumber;
  const prName = `${remote.owner}/${remote.repo}#${n ?? '?'}`;
  if (n === undefined) return { ok: false, reason: 'PR numarası yok.' };
  if (remote.apiBase === '') return { ok: false, reason: 'Yerel test deposu: PR bilgisi (GitHub API) alınmaz.' };
  if (!isTrustedHost(remote.host)) {
    return {
      ok: false,
      reason:
        `${remote.host} güvenilir GitHub sunucuları listesinde olmadığı için PR bilgisi (başlık, taban dal) istenmedi. ` +
        `Bu bir GitHub Enterprise sunucusuysa ${TRUSTED_HOSTS_ENV}=${remote.host} ile izin verin; aksi halde taban dalı elle girin.`,
    };
  }
  const auth = resolveGithubTokenFor(remote.host, opts.tokenEnvNames ?? DEFAULT_TOKEN_ENVS);
  const token = auth.token;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${remote.apiBase}/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}/pulls/${n}`;

  let res: Response;
  try {
    // Yönlendirme izlenmez: token başka bir adrese taşınmasın.
    res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) });
  } catch (err) {
    if (isEgressBlocked(err)) {
      return {
        ok: false,
        reason: `PR bilgisi alınamadı: ${new URL(remote.apiBase).hostname} adresine bağlantı Reviewist çıkış bekçisi tarafından engellendi.`,
      };
    }
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      reason: timeout
        ? `PR bilgisi alınamadı: GitHub API zamanında yanıt vermedi (${prName}).`
        : `PR bilgisi alınamadı: GitHub API'ye bağlanılamadı (${hide(shortMessage(err, 120), token)}). Ağ bağlantısını kontrol edin.`,
    };
  }

  if (res.status >= 300 && res.status < 400) {
    return {
      ok: false,
      reason: `PR bilgisi alınamadı: GitHub API yönlendirme döndürdü (HTTP ${res.status}); depo taşınmış ya da yeniden adlandırılmış olabilir. Güncel adresi kullanın.`,
    };
  }
  if (!res.ok) {
    const gh = await readGithubMessage(res);
    const detail = gh ? ` (GitHub: ${hide(gh, token)})` : '';
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetRaw = res.headers.get('x-ratelimit-reset');
    const reset = resetRaw !== null ? Number(resetRaw) : undefined;
    const rateLimited = res.status === 429 || (res.status === 403 && (remaining === '0' || /rate limit/i.test(gh ?? '')));
    const withheld = auth.withheldEnv ? ` ${auth.withheldEnv} bu sunucuya gönderilmedi.` : '';
    let reason: string;
    if (res.status === 401) {
      reason = `PR bilgisi alınamadı (401): GitHub token geçersiz ya da süresi dolmuş. GITHUB_TOKEN / GH_TOKEN değerini kontrol edin.${detail}`;
    } else if (rateLimited) {
      reason =
        `PR bilgisi alınamadı: GitHub API istek sınırı aşıldı; sınır ${formatReset(reset)} sıfırlanacak.` +
        (token ? '' : ' Token olmadan saatte 60 istek yapılabilir; GITHUB_TOKEN ortam değişkenini ayarlayın.');
    } else if (res.status === 403) {
      reason = token
        ? `PR bilgisi alınamadı (403): ${prName}. Token'ın bu depoya okuma izni (Pull requests: read) olmalı.${detail}`
        : `PR bilgisi alınamadı (403): ${prName}. Bu depo için token gerekli; GITHUB_TOKEN ortam değişkenini ayarlayın.${withheld}${detail}`;
    } else if (res.status === 404) {
      reason = token
        ? `PR bulunamadı (404): ${prName}. PR numarasını ve token'ın bu depoya erişimini kontrol edin.`
        : `PR bulunamadı (404): ${prName}. PR yok ya da depo özel; özel depolar için GITHUB_TOKEN (ya da GH_TOKEN) ortam değişkenini ayarlayın.${withheld}`;
    } else {
      reason = `PR bilgisi alınamadı: GitHub API hatası (HTTP ${res.status}).${detail}`;
    }
    return { ok: false, reason };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'PR bilgisi alınamadı: GitHub API yanıtı JSON değil.' };
  }
  const parsed = pullSchema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: 'PR bilgisi alınamadı: GitHub API yanıtı beklenen biçimde değil.' };
  const p = parsed.data;
  const info: PrInfo = { title: p.title, baseRef: p.base.ref, baseSha: p.base.sha, headRef: p.head.ref, headSha: p.head.sha };
  if (p.body) info.body = p.body;
  if (p.user?.login) info.author = p.user.login;
  if (p.html_url && /^https:\/\//.test(p.html_url)) info.htmlUrl = p.html_url;
  return { ok: true, info };
}

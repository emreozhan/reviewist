import type { GithubReviewRequest } from '../../../../../src/shared/types';

/**
 * GitHub formunun saf mantığı (sürüm sabitinden bağımsız; testlerde yerel sürümle de koşar).
 * Sunucu adresi asıl olarak doğrular; burada yalnız açık yanlışlar ve zorunlu alanlar yakalanır.
 */

/** PR adresi gibi mi: `…/pull/<sayı>` ya da `sahip/depo#<sayı>`. Değilse depo adresi sayılır ve head zorunludur. */
export function looksLikePrUrl(url: string): boolean {
  const u = url.trim();
  return /\/pull\/\d+(?:[/?#]|$)/.test(u) || /#\d+$/.test(u);
}

const HTTP_REPO = /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+/i;
const SCP_REPO = /^[\w.-]+@[^:/\s]+:[^/\s]+\/[^/\s]+$/; // git@github.com:sahip/depo.git
const SSH_REPO = /^ssh:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+/i;
const SHORT_REPO = /^[\w.-]+\/[\w.-]+(?:#\d+)?$/; // sahip/depo, sahip/depo#12

/** Tanınan adres biçimlerinden biri mi (PR ya da depo). */
export function isRecognizedTarget(url: string): boolean {
  const u = url.trim();
  if (/\s/.test(u)) return false;
  return HTTP_REPO.test(u) || SCP_REPO.test(u) || SSH_REPO.test(u) || SHORT_REPO.test(u);
}

export type GithubField = 'url' | 'base' | 'head';
export type GithubFormErrors = Partial<Record<GithubField, string>>;

export interface GithubFormInput {
  url: string;
  base: string;
  head: string;
}

export const URL_EXAMPLE = 'https://github.com/sahip/depo/pull/123';

/** Form doğrulaması: hata yoksa gönderilecek istek, varsa alan başına Türkçe hata. */
export function validateGithubForm(input: GithubFormInput): { errors: GithubFormErrors; request?: GithubReviewRequest } {
  const url = input.url.trim();
  const base = input.base.trim();
  const head = input.head.trim();
  const errors: GithubFormErrors = {};
  if (!url) errors.url = `zorunlu; ör. ${URL_EXAMPLE}, sahip/depo#123 ya da https://github.com/sahip/depo`;
  else if (!isRecognizedTarget(url)) errors.url = 'biçim tanınmadı; PR adresi (…/sahip/depo/pull/123, sahip/depo#123) ya da depo adresi (https://…/sahip/depo, git@…:sahip/depo.git) girin.';
  if (url && !looksLikePrUrl(url) && !head) errors.head = 'zorunlu; depo adresinde incelenecek dal, etiket ya da commit girilmeli (ör. feature/odeme).';
  if (/\s/.test(base)) errors.base = 'boşluk içeremez.';
  if (/\s/.test(head)) errors.head = 'boşluk içeremez.';
  if (base && head && base === head && !errors.head) errors.head = 'taban ile aynı olamaz.';
  if (Object.keys(errors).length > 0) return { errors };
  const request: GithubReviewRequest = { kind: 'github', url };
  if (base) request.base = base;
  if (head) request.head = head;
  return { errors, request };
}

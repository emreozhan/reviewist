/**
 * Kod gözatma (peek) yığını: saf durum geçişleri (React/zustand'dan bağımsız, birim testli).
 *
 * Her seviye bir sembolün gözatma penceresidir; üstteki etkindir. Bir penceredeki bağlantı yeni pencereyi o
 * pencerenin hemen üstüne açar (üstündekiler kapanır). Aynı hedef zaten yığındaysa yeni pencere açılmaz,
 * o seviyeye dönülür. En fazla MAX_PEEK_DEPTH seviye tutulur; aşılırsa en alttaki düşer.
 */
import type { NavTarget } from './navTarget';

export const MAX_PEEK_DEPTH = 8;

export interface PeekRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PeekEntry {
  /** Pencere örneğinin benzersiz anahtarı. */
  uid: string;
  /** Aynı hedefi tanımak için: sembol (+ çağrı yerinde dosya:satır). */
  identity: string;
  symbolId: string;
  target: NavTarget;
  /** Kırıntı izi metni: 'OrderController.cancel'. */
  crumb: string;
  /** Kullanıcı sürükledi/boyutlandırdıysa panel içindeki konum (yoksa basamaklı varsayılan). */
  rect?: PeekRect;
  maximized: boolean;
  /** Açılışı tetikleyen tık noktası (ekran koordinatı; bağlantı çizgisi için). */
  origin?: { x: number; y: number };
}

/**
 * Yeni pencerenin nereye ekleneceği:
 *   'new'  → yeni zincir (yığın değiştirilir; orta paneldeki koddan açılır),
 *   'top'  → en üste (denetçi, etki haritası),
 *   sayı   → o seviyedeki pencerenin içinden: üstündekiler kapanır, yenisi onun üstüne.
 */
export type PeekFrom = number | 'top' | 'new';

export interface PushResult {
  entries: PeekEntry[];
  /** Derinlik sınırı yüzünden alttan düşen pencere sayısı. */
  dropped: number;
  /** Hedef zaten yığındaydı: yeni pencere açılmadı, o seviyeye dönüldü. */
  reused: boolean;
}

export function peekIdentity(symbolId: string, target: Pick<NavTarget, 'callSite' | 'path' | 'line'>): string {
  return target.callSite ? `${symbolId}@${target.path}:${target.line ?? ''}` : symbolId;
}

export function pushPeek(entries: readonly PeekEntry[], entry: PeekEntry, from: PeekFrom): PushResult {
  const existing = entries.findIndex((e) => e.identity === entry.identity);
  if (existing >= 0) return { entries: entries.slice(0, existing + 1), dropped: 0, reused: true };
  const base = from === 'new' ? [] : from === 'top' ? entries.slice() : entries.slice(0, Math.max(0, Math.min(entries.length, from + 1)));
  const next = [...base, entry];
  const dropped = Math.max(0, next.length - MAX_PEEK_DEPTH);
  return { entries: dropped > 0 ? next.slice(dropped) : next, dropped, reused: false };
}

/** `level` seviyesine döner (üstündekiler kapanır). Geçersiz seviyede yığın değişmez. */
export function returnToLevel(entries: readonly PeekEntry[], level: number): PeekEntry[] {
  if (level < 0 || level >= entries.length) return entries.slice();
  return entries.slice(0, level + 1);
}

export function closeTopPeek(entries: readonly PeekEntry[]): PeekEntry[] {
  return entries.slice(0, -1);
}

export function updatePeek(entries: readonly PeekEntry[], uid: string, patch: Partial<Pick<PeekEntry, 'rect' | 'maximized'>>): PeekEntry[] {
  return entries.map((e) => (e.uid === uid ? { ...e, ...patch } : e));
}

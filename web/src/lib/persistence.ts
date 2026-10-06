import type { ReviewModel } from '../../../src/shared/types';

export interface PersistedReviewState {
  seen: Record<string, boolean>;
  notes: Record<string, string>;
  /**
   * Dosya id → "görüldü" işaretlendiği andaki değişiklik parmak izi. Eski kayıtlarda yoktur: parmak izsiz işaret
   * görüldü sayılmaya devam eder (geri uyum).
   */
  seenPrints?: Record<string, string>;
}

/** Tek bir yazımın dokunduğu alanlar (alan bazında son yazan kazanır). */
export interface ProgressPatch {
  /** `print`: işaretlendiği andaki parmak izi (false'ta yok sayılır). */
  seen?: Record<string, { value: boolean; print?: string }>;
  notes?: Record<string, string>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const EMPTY_STATE: PersistedReviewState = { seen: {}, notes: {} };

/** Kalıcılık anahtarı: aynı incelemenin tekrar analizlerinde değişmeyen `source.stableKey`. */
export function storageKey(review: Pick<ReviewModel, 'id' | 'source'>): string {
  // Eski sunucu stableKey göndermeyebilir: o durumda eski anahtar kullanılır.
  return review.source.stableKey ? `reviewist:${review.source.stableKey}` : legacyStorageKey(review);
}

/** Tur 1 anahtarı (head sha ya da review id); bir kerelik taşıma için okunur. */
export function legacyStorageKey(review: Pick<ReviewModel, 'id' | 'source'>): string {
  return `reviewist:${review.source.headSha ?? review.id}`;
}

/** Not anahtarları: dosya ve sembol notları ayrı ad alanında tutulur. */
export const fileNoteKey = (path: string): string => `file:${path}`;
export const symbolNoteKey = (id: string): string => `sym:${id}`;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (error) {
    console.warn('localStorage erişilemiyor', error);
    return null;
  }
}

function isRecordOf<T>(value: unknown, check: (v: unknown) => v is T): value is Record<string, T> {
  return typeof value === 'object' && value !== null && Object.values(value).every(check);
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isString = (v: unknown): v is string => typeof v === 'string';

export function loadState(key: string, storage: KeyValueStorage | null = defaultStorage()): PersistedReviewState {
  if (!storage) return { seen: {}, notes: {} };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { seen: {}, notes: {} };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { seen: {}, notes: {} };
    const { seen, notes, seenPrints } = parsed as { seen?: unknown; notes?: unknown; seenPrints?: unknown };
    const out: PersistedReviewState = {
      seen: isRecordOf(seen, isBool) ? { ...seen } : {},
      notes: isRecordOf(notes, isString) ? { ...notes } : {},
    };
    if (isRecordOf(seenPrints, isString) && Object.keys(seenPrints).length > 0) out.seenPrints = { ...seenPrints };
    return out;
  } catch (error) {
    console.warn('Kayıtlı inceleme durumu okunamadı', error);
    return { seen: {}, notes: {} };
  }
}

export function saveState(key: string, state: PersistedReviewState, storage: KeyValueStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const notes = Object.fromEntries(Object.entries(state.notes).filter(([, v]) => v.trim() !== ''));
    const seen = Object.fromEntries(Object.entries(state.seen).filter(([, v]) => v));
    const prints = Object.fromEntries(Object.entries(state.seenPrints ?? {}).filter(([id]) => seen[id]));
    storage.setItem(key, JSON.stringify(Object.keys(prints).length > 0 ? { seen, notes, seenPrints: prints } : { seen, notes }));
    return true;
  } catch (error) {
    console.warn('İnceleme durumu kaydedilemedi', error);
    return false;
  }
}

function isEmpty(state: PersistedReviewState): boolean {
  return Object.keys(state.seen).length === 0 && Object.keys(state.notes).length === 0;
}

/**
 * Yeni anahtardan okur; orada kayıt yoksa ve eski anahtarda varsa bir kerelik yeni anahtara taşır
 * (eski kayıt silinir, böylece taşıma tekrarlanmaz).
 */
export function loadStateMigrating(key: string, legacyKey: string, storage: KeyValueStorage | null = defaultStorage()): PersistedReviewState {
  const current = loadState(key, storage);
  if (!storage || legacyKey === key || !isEmpty(current)) return current;
  const legacy = loadState(legacyKey, storage);
  if (isEmpty(legacy)) return current;
  if (saveState(key, legacy, storage)) {
    try {
      storage.removeItem?.(legacyKey);
    } catch (error) {
      console.warn('Eski inceleme durumu silinemedi', error);
    }
  }
  return legacy;
}

/** Saf: yamayı duruma uygular (yalnız yamadaki alanlar değişir; diğerleri olduğu gibi kalır). */
export function applyPatch(state: PersistedReviewState, patch: ProgressPatch): PersistedReviewState {
  const seen = { ...state.seen };
  const prints = { ...(state.seenPrints ?? {}) };
  for (const [id, { value, print }] of Object.entries(patch.seen ?? {})) {
    if (value) {
      seen[id] = true;
      if (print) prints[id] = print;
      else delete prints[id];
    } else {
      delete seen[id];
      delete prints[id];
    }
  }
  const notes = { ...state.notes };
  for (const [k, text] of Object.entries(patch.notes ?? {})) {
    if (text.trim() === '') delete notes[k];
    else notes[k] = text;
  }
  const out: PersistedReviewState = { seen, notes };
  if (Object.keys(prints).length > 0) out.seenPrints = prints;
  return out;
}

/**
 * Oku-birleştir-yaz: diskteki güncel durumu (başka tarayıcı sekmesinin yazdıkları dahil) okur, yalnız yamadaki
 * alanları üzerine uygular ve yazar. Böylece iki sekme aynı incelemede farklı notlar yazınca biri diğerini ezmez.
 * Depolama yoksa `fallback` (bellekteki durum) üzerine uygulanır; yazılamazsa `ok: false` döner.
 */
export function updateState(
  key: string,
  patch: ProgressPatch,
  fallback: PersistedReviewState,
  storage: KeyValueStorage | null = defaultStorage(),
): { state: PersistedReviewState; ok: boolean } {
  if (!storage) return { state: applyPatch(fallback, patch), ok: false };
  const state = applyPatch(loadState(key, storage), patch);
  return { state, ok: saveState(key, state, storage) };
}

export interface EffectiveSeen {
  /** Şu an görüldü sayılan dosyalar. */
  seen: Record<string, boolean>;
  /** Görüldü işaretlenmiş ama o zamandan beri değişikliği farklılaşmış dosyalar (görülmedi sayılır). */
  stale: Record<string, boolean>;
}

/**
 * Saf: kayıtlı işaretleri güncel parmak izleriyle karşılaştırır. İzi kayıtlı ve güncel izden farklıysa dosya
 * "görülmedi" ve "görüldükten sonra değişti" sayılır; izsiz (eski) kayıt ya da güncel izi bilinmeyen dosya
 * görüldü kalır.
 */
export function effectiveSeen(state: PersistedReviewState, prints: Readonly<Record<string, string>>): EffectiveSeen {
  const seen: Record<string, boolean> = {};
  const stale: Record<string, boolean> = {};
  for (const [id, v] of Object.entries(state.seen)) {
    if (!v) continue;
    const saved = state.seenPrints?.[id];
    const current = prints[id];
    if (saved && current && saved !== current) stale[id] = true;
    else seen[id] = true;
  }
  return { seen, stale };
}

import type { ReviewModel } from '../../../src/shared/types';

export interface PersistedReviewState {
  seen: Record<string, boolean>;
  notes: Record<string, string>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const EMPTY_STATE: PersistedReviewState = { seen: {}, notes: {} };

export function storageKey(review: Pick<ReviewModel, 'id' | 'source'>): string {
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
    const { seen, notes } = parsed as { seen?: unknown; notes?: unknown };
    return {
      seen: isRecordOf(seen, isBool) ? { ...seen } : {},
      notes: isRecordOf(notes, isString) ? { ...notes } : {},
    };
  } catch (error) {
    console.warn('Kayıtlı review durumu okunamadı', error);
    return { seen: {}, notes: {} };
  }
}

export function saveState(key: string, state: PersistedReviewState, storage: KeyValueStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const notes = Object.fromEntries(Object.entries(state.notes).filter(([, v]) => v.trim() !== ''));
    const seen = Object.fromEntries(Object.entries(state.seen).filter(([, v]) => v));
    storage.setItem(key, JSON.stringify({ seen, notes }));
    return true;
  } catch (error) {
    console.warn('Review durumu kaydedilemedi', error);
    return false;
  }
}

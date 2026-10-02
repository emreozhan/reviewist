import { create } from 'zustand';

/** Başlangıç ekranında gösterilen kısa bilgi notu (ör. açılışta otomatik açılan review bulunamadı). */
interface NoticeState {
  notice: string | null;
  /** Config'teki initialReviewId ile otomatik açılmaya çalışılan review. */
  initialAttemptId: string | null;
  setNotice: (text: string | null) => void;
  markInitialAttempt: (id: string | null) => void;
}

export const useNotice = create<NoticeState>((set) => ({
  notice: null,
  initialAttemptId: null,
  setNotice: (text) => set({ notice: text }),
  markInitialAttempt: (id) => set({ initialAttemptId: id }),
}));

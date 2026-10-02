import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ReviewModel } from '../../../../src/shared/types';
import type { ReviewIndex } from '../../lib/reviewIndex';

interface ReviewCtx {
  review: ReviewModel;
  index: ReviewIndex;
}

const Ctx = createContext<ReviewCtx | null>(null);

export function ReviewProvider({ review, index, children }: ReviewCtx & { children: ReactNode }) {
  return <Ctx.Provider value={{ review, index }}>{children}</Ctx.Provider>;
}

export function useReviewCtx(): ReviewCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useReviewCtx yalnız ReviewProvider içinde kullanılabilir');
  return ctx;
}

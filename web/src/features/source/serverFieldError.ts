import type { ReviewRequest } from '../../../../src/shared/types';

/** Sunucunun doğrulama hatası (ApiError.field) — ilgili form alanının altında gösterilir. */
export interface ServerFieldError {
  kind: ReviewRequest['kind'];
  field: string;
  message: string;
}

/** Her kaynak formunun gösterebildiği istek alanları (ReviewRequest alan adlarıyla). */
const FORM_FIELDS: Record<ReviewRequest['kind'], readonly string[]> = {
  git: ['repoPath', 'base', 'head'],
  worktree: ['repoPath', 'base'],
  github: ['url', 'token', 'localRepoPath'],
  patch: ['text', 'repoPath'],
};

export function formHasField(kind: ReviewRequest['kind'], field: string): boolean {
  return FORM_FIELDS[kind].includes(field);
}

/** Formdaki alan için sunucu hatası (yalnız aynı kaynak türünden geldiyse). */
export function serverErrorFor(err: ServerFieldError | undefined, kind: ReviewRequest['kind'], field: string): string | undefined {
  return err && err.kind === kind && err.field === field ? err.message : undefined;
}

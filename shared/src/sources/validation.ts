/**
 * İstek doğrulama yardımcıları: iki uygulamanın (local, github) istek şemaları bunları paylaşır.
 */
import { z } from 'zod';
import { SourceError } from './errors.js';

/** Boş olmayan, kırpılmış metin alanı. */
export const str = (field: string) =>
  z
    .string({ error: `${field} metin olmalı` })
    .trim()
    .min(1, { error: `${field} boş olamaz` });

/** zod hatasını `alan: mesaj` satırlarına çevirir (değerler mesaja girmez). */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length > 0 ? i.path.map(String).join('.') : '(gövde)';
      return `${path}: ${i.message}`;
    })
    .join('; ');
}

/** İlk zod hatasının yolunun ilk elemanı (ör. 'base', 'url'); ApiError.field olarak döner. */
export function zodErrorField(err: z.ZodError): string | undefined {
  const first = err.issues[0]?.path[0];
  return first === undefined ? undefined : String(first);
}

/** Gövdeyi verilen şemayla doğrular; hatada 400 SourceError (`field`: ilk hatalı alan). */
export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new SourceError('İstek gövdesi bir JSON nesnesi olmalı.', { status: 400, code: 'VALIDATION' });
  }
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new SourceError(`Geçersiz review isteği: ${formatZodError(r.error)}`, {
      status: 400,
      code: 'VALIDATION',
      field: zodErrorField(r.error),
    });
  }
  return r.data;
}

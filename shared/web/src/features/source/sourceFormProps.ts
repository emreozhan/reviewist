import type { AppConfig, ReviewRequest } from '../../../../src/shared/types';
import type { ServerFieldError } from './serverFieldError';

/** Kaynak formlarının ortak özellikleri (iki sürümde de). */
export interface SourceFormProps {
  config?: AppConfig;
  pending: boolean;
  onSubmit: (req: ReviewRequest) => void;
  /** Sunucunun alan hatası (ApiError.field). */
  serverError?: ServerFieldError;
  /** Formda bir alan değişince (sunucu hatasını temizlemek için). */
  onEdit?: () => void;
}

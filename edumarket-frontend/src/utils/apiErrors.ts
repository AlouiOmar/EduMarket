import type { TFunction } from 'i18next';
import i18n from '../i18n';

export interface ApiErrorLike { code?: string; status?: number; message?: string }

/** Backend errors carry stable codes (`{ error: { code } }`); the UI translates them with i18next. */
export function apiErrorCode(error: unknown): string {
  const candidate = error as ApiErrorLike | undefined;
  return candidate?.code || (candidate?.message && /^[A-Z][A-Z0-9_]+$/.test(candidate.message) ? candidate.message : 'GENERIC');
}

export function apiErrorMessage(t: TFunction, error: unknown): string {
  const code = apiErrorCode(error);
  return t(`apiErrors.${code}`, { defaultValue: t('apiErrors.GENERIC') });
}

/** Same translation outside React render scope (event handlers, promise callbacks). */
export function describeApiError(error: unknown): string {
  return apiErrorMessage(i18n.t.bind(i18n) as TFunction, error);
}

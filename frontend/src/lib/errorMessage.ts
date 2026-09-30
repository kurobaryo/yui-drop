import type { TFunction } from 'i18next';

import { ApiError } from '@/lib/api';

/**
 * Turn any thrown value into a sentence a visitor can act on.
 *
 * Backend errors carry a machine message (`code_not_found`,
 * `invalid_password`, ...). Known ones map to `errors.<message>` in the
 * locale files; unknown ones fall back to a status-based sentence, then to
 * the caller's fallback. Raw axios text ("Request failed with status code
 * 404") is never shown.
 */
export function errorMessage(e: unknown, t: TFunction, fallback: string): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.message}`;
    const mapped = t(key, { defaultValue: '' });
    if (mapped) return mapped;
    if (e.code === 4003) return t('turnstile.failed');
    if (e.httpStatus === 429 || e.code === 4291) return t('errors.rate_limited');
    if (e.httpStatus === 413) return t('errors.file_too_large');
    if (e.httpStatus === 0 || e.httpStatus === null) return t('errors.network_error');
    if (e.httpStatus && e.httpStatus >= 500) return t('errors.server_error');
    return fallback;
  }
  if (e instanceof Error && e.message && !/^Request failed with status code/.test(e.message)) {
    return e.message;
  }
  return fallback;
}

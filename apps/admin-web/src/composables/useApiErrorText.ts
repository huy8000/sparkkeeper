import { isRef, type Ref } from 'vue';

import { useTranslation } from '../i18n';
import { apiErrorTranslationKey } from '../i18n/apiErrorCodes';

/** Structured error snapshot (code + message), e.g. an ApiError instance. */
export type ApiErrorLike = {
  readonly code?: string | null;
  readonly message?: string | null;
} | null;

/** Error display source: a structured error, or an already-localized string. */
export type ApiErrorSource = ApiErrorLike | undefined | string;

/**
 * Single humanization point for server ApiError payloads. Known stable codes
 * map to translation keys in every locale, so raw English server text never
 * leaks into the zh-CN UI (and en-US copy stays locale-managed). Unknown or
 * future codes fall back to the server's safe message, then to a localized
 * generic copy. Plain strings pass through untouched: they are either
 * client-side validation copy or pre-translated fallbacks.
 *
 * The helper must be called at render time (template or computed), never
 * pre-resolved into state, so switching the language re-renders existing
 * error UI without refetching or retrying anything.
 */
export function useApiErrorText() {
  const { t } = useTranslation();

  function apiErrorText(source: ApiErrorSource | Ref<ApiErrorSource>): string {
    const unwrapped = isRef(source) ? source.value : source;
    if (typeof unwrapped === 'string') return unwrapped;
    if (unwrapped === null || unwrapped === undefined) return '';
    const key = apiErrorTranslationKey(unwrapped.code);
    if (key !== null) return t(key);
    const message = unwrapped.message?.trim();
    if (message !== undefined && message !== '') return message;
    return t('errors.api.unknown');
  }

  return { apiErrorText };
}

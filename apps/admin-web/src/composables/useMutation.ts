import { ref, type Ref } from 'vue';

import { ApiError } from '../api/client';
import { useTranslation } from '../i18n';

export interface MutationState {
  readonly submitting: Ref<boolean>;
  /**
   * ApiError snapshot (localized at render time) or a pre-translated generic
   * fallback. Never stores a raw server message resolved ahead of time.
   */
  readonly error: Ref<ApiError | string>;
  readonly success: Ref<string>;
  readonly execute: <T>(
    action: () => Promise<T>,
    onSuccess: (result: T) => Promise<void> | void,
    successMessage: string,
  ) => Promise<void>;
  readonly clearError: () => void;
}

export function useMutation(): MutationState {
  const { t } = useTranslation();
  const submitting = ref(false);
  const error = ref<ApiError | string>('');
  const success = ref('');

  async function execute<T>(
    action: () => Promise<T>,
    onSuccess: (result: T) => Promise<void> | void,
    successMessage: string,
  ): Promise<void> {
    if (submitting.value) return;
    submitting.value = true;
    error.value = '';
    success.value = '';
    try {
      const result = await action();
      await onSuccess(result);
      success.value = successMessage;
    } catch (cause) {
      error.value = cause instanceof ApiError ? cause : t('common.saveFailed');
    } finally {
      submitting.value = false;
    }
  }

  return {
    submitting,
    error,
    success,
    execute,
    clearError: () => {
      error.value = '';
    },
  };
}

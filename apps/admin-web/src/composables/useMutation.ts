import { ref, type Ref } from 'vue';

import { ApiError } from '../api/client';

export interface MutationState {
  readonly submitting: Ref<boolean>;
  readonly error: Ref<string>;
  readonly success: Ref<string>;
  readonly execute: <T>(
    action: () => Promise<T>,
    onSuccess: (result: T) => Promise<void> | void,
    successMessage: string,
  ) => Promise<void>;
  readonly clearError: () => void;
}

export function useMutation(): MutationState {
  const submitting = ref(false);
  const error = ref('');
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
      error.value =
        cause instanceof ApiError
          ? cause.message
          : 'The configuration could not be saved. Please try again.';
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

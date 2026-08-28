import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue';

import { ApiError } from '../api/client';
import { useTranslation } from '../i18n';

export interface RequestState<T> {
  readonly data: ShallowRef<T | null>;
  readonly error: Ref<ApiError | null>;
  readonly loading: Ref<boolean>;
  readonly hasSnapshot: ComputedRef<boolean>;
  readonly initialLoading: ComputedRef<boolean>;
  readonly refreshing: ComputedRef<boolean>;
  readonly initialError: ComputedRef<ApiError | null>;
  readonly refreshError: ComputedRef<ApiError | null>;
  readonly load: () => Promise<void>;
  readonly cancel: () => void;
  readonly reset: () => void;
}

function safeError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(
        'UNEXPECTED_ERROR',
        useTranslation().t('common.unexpectedError'),
        0,
        'MALFORMED',
      );
}

export function useRequest<T>(loader: (signal: AbortSignal) => Promise<T>): RequestState<T> {
  const data = shallowRef<T | null>(null);
  const error = ref<ApiError | null>(null);
  const loading = ref(false);
  let controller: AbortController | undefined;
  let requestNumber = 0;

  const hasSnapshot = computed(() => data.value !== null);
  const initialLoading = computed(() => loading.value && data.value === null);
  const refreshing = computed(() => loading.value && data.value !== null);
  const initialError = computed(() => (data.value === null ? error.value : null));
  const refreshError = computed(() => (data.value === null ? null : error.value));

  function cancel(): void {
    controller?.abort();
    controller = undefined;
  }

  function reset(): void {
    cancel();
    requestNumber += 1;
    data.value = null;
    error.value = null;
    loading.value = false;
  }

  async function load(): Promise<void> {
    cancel();
    const currentRequest = ++requestNumber;
    controller = new AbortController();
    loading.value = true;
    error.value = null;
    try {
      const result = await loader(controller.signal);
      if (currentRequest === requestNumber) data.value = result;
    } catch (cause) {
      const requestError = safeError(cause);
      if (currentRequest === requestNumber && requestError.kind !== 'ABORT')
        error.value = requestError;
    } finally {
      if (currentRequest === requestNumber) loading.value = false;
    }
  }

  onMounted(() => void load());
  onBeforeUnmount(cancel);

  return {
    data,
    error,
    loading,
    hasSnapshot,
    initialLoading,
    refreshing,
    initialError,
    refreshError,
    load,
    cancel,
    reset,
  };
}

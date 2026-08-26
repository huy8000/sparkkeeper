import { onBeforeUnmount, onMounted, ref, shallowRef, type Ref, type ShallowRef } from 'vue';

import { ApiError } from '../api/client';

export interface RequestState<T> {
  readonly data: ShallowRef<T | null>;
  readonly error: Ref<ApiError | null>;
  readonly loading: Ref<boolean>;
  readonly load: () => Promise<void>;
  readonly cancel: () => void;
}

function safeError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError('UNEXPECTED_ERROR', 'Something went wrong. Please try again.', 0, 'MALFORMED');
}

export function useRequest<T>(loader: (signal: AbortSignal) => Promise<T>): RequestState<T> {
  const data = shallowRef<T | null>(null);
  const error = ref<ApiError | null>(null);
  const loading = ref(false);
  let controller: AbortController | undefined;
  let requestNumber = 0;

  function cancel(): void {
    controller?.abort();
    controller = undefined;
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

  return { data, error, loading, load, cancel };
}

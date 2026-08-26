import { readonly, ref, type Ref } from 'vue';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface ToastItem {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
}

export const DEFAULT_TOAST_DURATION_MS = 4000;

const toasts = ref<ToastItem[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextToastId = 1;

export interface ToastState {
  readonly toasts: Readonly<Ref<readonly ToastItem[]>>;
  readonly notify: (tone: ToastTone, message: string, durationMs?: number) => number;
  readonly dismiss: (id: number) => void;
}

/**
 * App-wide toast queue. Replaces browser alert() everywhere; ToastHost renders
 * the queue without covering confirmation modals.
 */
export function useToasts(): ToastState {
  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
  }

  function notify(
    tone: ToastTone,
    message: string,
    durationMs = DEFAULT_TOAST_DURATION_MS,
  ): number {
    const id = nextToastId++;
    toasts.value = [...toasts.value, { id, tone, message }];
    timers.set(
      id,
      setTimeout(() => dismiss(id), durationMs),
    );
    return id;
  }

  return { toasts: readonly(toasts), notify, dismiss };
}

/** Test hook: clear queued toasts and pending auto-dismiss timers. */
export function resetToastsForTest(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts.value = [];
}

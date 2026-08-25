import { onBeforeUnmount } from 'vue';

export interface DebouncedAction {
  readonly trigger: () => void;
  readonly cancel: () => void;
}

export function useDebouncedAction(action: () => void, delayMs = 500): DebouncedAction {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function trigger(): void {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      action();
    }, delayMs);
  }

  onBeforeUnmount(cancel);
  return { trigger, cancel };
}

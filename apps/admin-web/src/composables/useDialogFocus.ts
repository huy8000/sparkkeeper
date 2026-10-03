/* global HTMLElement, KeyboardEvent */
import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';

const stack: symbol[] = [];
let background: HTMLElement | null = null;
let wasInert = false;
export function useDialogFocus(
  panel: Ref<HTMLElement | null>,
  open: () => boolean,
  close: () => void,
) {
  const id = Symbol('dialog');
  let previous: HTMLElement | null = null;
  const controls = () =>
    [
      ...(panel.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ].filter(
      (el) =>
        !el.closest('[hidden], [inert]') && globalThis.getComputedStyle(el).display !== 'none',
    );
  const key = (e: KeyboardEvent) => {
    if (stack.at(-1) !== id) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
    if (e.key !== 'Tab') return;
    const items = controls(),
      first = items[0] ?? panel.value,
      last = items.at(-1) ?? panel.value;
    if (
      !panel.value?.contains(globalThis.document.activeElement) ||
      (e.shiftKey && globalThis.document.activeElement === first) ||
      (!e.shiftKey && globalThis.document.activeElement === last)
    ) {
      e.preventDefault();
      (e.shiftKey ? last : first)?.focus();
    }
  };
  function release() {
    const index = stack.indexOf(id);
    if (index < 0) return;
    const top = stack.at(-1) === id;
    stack.splice(index, 1);
    globalThis.document.removeEventListener('keydown', key, true);
    if (!stack.length) {
      if (background && !wasInert) background.removeAttribute('inert');
      background = null;
    }
    if (top && previous?.isConnected) previous.focus();
    previous = null;
  }
  watch(
    open,
    (active) => {
      if (!active) return release();
      previous =
        globalThis.document.activeElement instanceof HTMLElement
          ? globalThis.document.activeElement
          : null;
      if (!stack.length) {
        background = globalThis.document.querySelector('.app-shell');
        wasInert = background?.hasAttribute('inert') ?? false;
        background?.setAttribute('inert', '');
      }
      stack.push(id);
      globalThis.document.addEventListener('keydown', key, true);
      void nextTick(() => {
        if (open() && stack.at(-1) === id) (controls()[0] ?? panel.value)?.focus();
      });
    },
    { immediate: true },
  );
  onBeforeUnmount(release);
}

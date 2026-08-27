<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
/* global document, HTMLElement, KeyboardEvent */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string; labelledBy?: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close');
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.addEventListener('keydown', handleKeydown);
      void nextTick(() =>
        dialog.value
          ?.querySelector<HTMLElement>('button, [href], input, select, textarea')
          ?.focus(),
      );
    } else {
      document.removeEventListener('keydown', handleKeydown);
      previousFocus?.focus();
      previousFocus = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  previousFocus?.focus();
});
</script>

<template>
  <Teleport v-if="open" to="body">
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div
        ref="dialog"
        class="modal-card"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledBy ?? 'modal-title'"
      >
        <header class="modal-card__header">
          <h3 :id="labelledBy ?? 'modal-title'">{{ title }}</h3>
          <button
            class="modal-card__dismiss"
            type="button"
            aria-label="Close dialog"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

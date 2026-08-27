<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
/* global document, HTMLElement, KeyboardEvent */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);
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
        panel.value?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus(),
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
    <div class="drawer-backdrop" @click.self="$emit('close')">
      <aside ref="panel" class="drawer" role="dialog" aria-modal="true" :aria-label="title">
        <header class="drawer__header">
          <h3>{{ title }}</h3>
          <button
            class="modal-card__dismiss"
            type="button"
            aria-label="Close panel"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>
        <div class="drawer__body">
          <slot />
        </div>
      </aside>
    </div>
  </Teleport>
</template>

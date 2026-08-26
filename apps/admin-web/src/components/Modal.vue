<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
/* global document, KeyboardEvent */
import { onBeforeUnmount, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string; labelledBy?: string }>();
const emit = defineEmits<{ close: [] }>();

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close');
}

watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('keydown', handleKeydown);
    else document.removeEventListener('keydown', handleKeydown);
  },
  { immediate: true },
);

onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport v-if="open" to="body">
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div
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

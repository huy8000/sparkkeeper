<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
/* global document, KeyboardEvent */
import { onBeforeUnmount, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string }>();
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
    <div class="drawer-backdrop" @click.self="$emit('close')">
      <aside class="drawer" role="dialog" aria-modal="true" :aria-label="title">
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

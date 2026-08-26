<script setup lang="ts">
import { useToasts } from '../composables/useToasts';

const { toasts, dismiss } = useToasts();
</script>

<template>
  <div class="toast-stack" aria-live="polite" role="status">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.tone}`">
      <span class="toast__message">{{ toast.message }}</span>
      <button
        class="toast__dismiss"
        type="button"
        :aria-label="`Dismiss ${toast.tone} notification`"
        @click="dismiss(toast.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>

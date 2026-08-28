<script setup lang="ts">
import { useToasts } from '../composables/useToasts';
import { useTranslation } from '../i18n';

const { toasts, dismiss } = useToasts();
const { t } = useTranslation();
</script>

<template>
  <div class="toast-stack" aria-live="polite" role="status">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.tone}`">
      <span class="toast__message">{{ toast.message }}</span>
      <button
        class="toast__dismiss"
        type="button"
        :aria-label="t('common.dismissNotification')"
        @click="dismiss(toast.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ApiErrorSource } from '../composables/useApiErrorText';
import { useApiErrorText } from '../composables/useApiErrorText';
import { useTranslation } from '../i18n';

defineProps<{
  title?: string;
  message?: string;
  error?: ApiErrorSource;
  retryLabel?: string;
}>();

defineEmits<{ retry: [] }>();

const { t } = useTranslation();
const { apiErrorText } = useApiErrorText();
</script>

<template>
  <section class="state-panel state-panel--error" role="alert">
    <div>
      <h2 class="state-panel__title">{{ title ?? t('common.unableToLoadData') }}</h2>
      <!-- Localized at render time so a language switch re-renders the copy. -->
      <p>{{ error !== undefined ? apiErrorText(error) : message }}</p>
    </div>
    <button class="button button--secondary" type="button" @click="$emit('retry')">
      {{ retryLabel ?? t('common.retry') }}
    </button>
  </section>
</template>

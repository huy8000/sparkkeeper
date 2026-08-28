<script setup lang="ts">
import type { ApiErrorSource } from '../composables/useApiErrorText';
import { useApiErrorText } from '../composables/useApiErrorText';
import { useTranslation } from '../i18n';

defineProps<{
  message?: string;
  error?: ApiErrorSource;
  retryLabel?: string;
}>();

defineEmits<{ retry: [] }>();

const { t } = useTranslation();
const { apiErrorText } = useApiErrorText();
</script>

<template>
  <div class="stale-data-notice" role="alert">
    <!-- Localized at render time so a language switch re-renders the copy. -->
    <span>{{
      error !== undefined ? apiErrorText(error) : (message ?? t('common.staleData'))
    }}</span>
    <button class="button button--secondary button--compact" type="button" @click="$emit('retry')">
      {{ retryLabel ?? t('common.refreshAgain') }}
    </button>
  </div>
</template>

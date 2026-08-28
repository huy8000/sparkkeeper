<script setup lang="ts">
import { useTranslation } from '../i18n';

defineProps<{
  message?: string;
  retryLabel?: string;
}>();

defineEmits<{ retry: [] }>();

const { t } = useTranslation();
</script>

<template>
  <div class="stale-data-notice" role="alert">
    <span>{{ message ?? t('common.staleData') }}</span>
    <button class="button button--secondary button--compact" type="button" @click="$emit('retry')">
      {{ retryLabel ?? t('common.refreshAgain') }}
    </button>
  </div>
</template>

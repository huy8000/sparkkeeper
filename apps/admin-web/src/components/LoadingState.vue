<script setup lang="ts">
import { useTranslation } from '../i18n';

defineProps<{ label?: string }>();

const { t } = useTranslation();
</script>

<template>
  <div class="state-panel" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <span>{{ label ?? t('common.loadingData') }}</span>
  </div>
</template>

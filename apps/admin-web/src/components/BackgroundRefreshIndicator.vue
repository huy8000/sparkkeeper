<script setup lang="ts">
import { useTranslation } from '../i18n';

defineProps<{ label?: string }>();

const { t } = useTranslation();
</script>

<template>
  <p class="background-refresh-indicator" role="status" aria-live="polite">
    <span class="background-refresh-indicator__pulse" aria-hidden="true" />
    {{ label ?? t('common.refreshingData') }}
  </p>
</template>

<script setup lang="ts">
import { useTranslation } from '../i18n';

defineProps<{ label?: string }>();

const { t } = useTranslation();
</script>

<template>
  <div class="section-loading" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <span class="section-loading__label">{{ label ?? t('common.loadingSection') }}</span>
  </div>
</template>

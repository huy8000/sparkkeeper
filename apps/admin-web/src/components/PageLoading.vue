<script setup lang="ts">
import { useTranslation } from '../i18n';

defineProps<{ label?: string }>();

const { t } = useTranslation();
</script>

<template>
  <!-- Section-local loading: the shell stays visible, never a full-screen spinner. -->
  <div class="page-loading" role="status" aria-live="polite">
    <div class="page-loading__skeletons" aria-hidden="true">
      <span class="skeleton skeleton--bar" />
      <span class="skeleton skeleton--block" />
      <span class="skeleton skeleton--block" />
    </div>
    <p class="page-loading__label">{{ label ?? t('common.loadingPage') }}</p>
  </div>
</template>

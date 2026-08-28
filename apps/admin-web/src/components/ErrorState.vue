<script setup lang="ts">
import { useTranslation } from '../i18n';

defineProps<{ title?: string; message: string; retryLabel?: string }>();

defineEmits<{ retry: [] }>();

const { t } = useTranslation();
</script>

<template>
  <section class="state-panel state-panel--error" role="alert">
    <div>
      <h2 class="state-panel__title">{{ title ?? t('common.unableToLoadData') }}</h2>
      <p>{{ message }}</p>
    </div>
    <button class="button button--secondary" type="button" @click="$emit('retry')">
      {{ retryLabel ?? t('common.retry') }}
    </button>
  </section>
</template>

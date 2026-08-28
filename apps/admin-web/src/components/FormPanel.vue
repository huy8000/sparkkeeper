<script setup lang="ts">
import { useTranslation } from '../i18n';

defineProps<{ title: string; description?: string }>();
defineEmits<{ cancel: [] }>();

const { t } = useTranslation();
</script>

<template>
  <section class="form-panel" role="region" :aria-label="title">
    <header class="form-panel__header">
      <div>
        <h3>{{ title }}</h3>
        <p v-if="description">{{ description }}</p>
      </div>
      <button class="button button--secondary" type="button" @click="$emit('cancel')">
        {{ t('common.cancel') }}
      </button>
    </header>
    <slot />
  </section>
</template>

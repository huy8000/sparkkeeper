<script setup lang="ts">
withDefaults(defineProps<{ title?: string; message: string; retryLabel?: string }>(), {
  title: 'Unable to load data',
  retryLabel: 'Retry',
});

defineEmits<{ retry: [] }>();
</script>

<template>
  <section class="state-panel state-panel--error" role="alert">
    <div>
      <h2 class="state-panel__title">{{ title }}</h2>
      <p>{{ message }}</p>
    </div>
    <button class="button button--secondary" type="button" @click="$emit('retry')">
      {{ retryLabel }}
    </button>
  </section>
</template>

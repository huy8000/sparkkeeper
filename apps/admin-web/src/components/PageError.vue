<script setup lang="ts">
withDefaults(defineProps<{ title?: string; message: string; retryLabel?: string }>(), {
  title: 'Unable to load data',
  retryLabel: 'Retry',
});

defineEmits<{ retry: [] }>();
</script>

<template>
  <section class="page-error" role="alert">
    <svg class="page-error__icon" viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="28" fill="var(--sk-danger-soft)" />
      <path
        d="M40 24v20M40 54v2"
        stroke="var(--sk-danger)"
        stroke-width="4"
        stroke-linecap="round"
      />
    </svg>
    <h2 class="page-error__title">{{ title }}</h2>
    <p class="page-error__message">{{ message }}</p>
    <button class="button button--secondary" type="button" @click="$emit('retry')">
      {{ retryLabel }}
    </button>
  </section>
</template>

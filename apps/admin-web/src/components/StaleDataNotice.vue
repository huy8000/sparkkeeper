<script setup lang="ts">
withDefaults(
  defineProps<{
    message?: string;
    retryLabel?: string;
  }>(),
  {
    message: 'Unable to refresh latest data. Showing the last successful snapshot.',
    retryLabel: 'Refresh again',
  },
);

defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="stale-data-notice" role="alert">
    <span>{{ message }}</span>
    <button class="button button--secondary button--compact" type="button" @click="$emit('retry')">
      {{ retryLabel }}
    </button>
  </div>
</template>

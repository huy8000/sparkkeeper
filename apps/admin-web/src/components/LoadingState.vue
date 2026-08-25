<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading data…' });
</script>

<template>
  <div class="state-panel" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <span>{{ label }}</span>
  </div>
</template>

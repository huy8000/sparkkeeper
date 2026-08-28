<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: 'Refreshing latest data…' });
</script>

<template>
  <p class="background-refresh-indicator" role="status" aria-live="polite">
    <span class="background-refresh-indicator__pulse" aria-hidden="true" />
    {{ label }}
  </p>
</template>

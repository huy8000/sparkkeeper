<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading section…' });
</script>

<template>
  <div class="section-loading" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <span class="section-loading__label">{{ label }}</span>
  </div>
</template>

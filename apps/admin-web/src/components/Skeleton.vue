<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
withDefaults(defineProps<{ width?: string; height?: string; label?: string }>(), {
  width: '100%',
  height: '14px',
  label: 'Loading content…',
});
</script>

<template>
  <span class="skeleton" role="status" :aria-label="label" :style="{ width, height }" />
</template>

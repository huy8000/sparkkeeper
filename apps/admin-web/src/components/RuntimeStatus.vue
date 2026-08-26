<script setup lang="ts">
import { computed } from 'vue';

type RuntimeIndicator = 'READY' | 'DEGRADED' | 'LOADING' | 'UNAVAILABLE';

const props = defineProps<{ status: RuntimeIndicator }>();

const indicator = computed(() => {
  switch (props.status) {
    case 'READY':
      return { label: 'System Ready', className: 'runtime-status--ready' };
    case 'DEGRADED':
      return { label: 'System Degraded', className: 'runtime-status--degraded' };
    case 'UNAVAILABLE':
      return { label: 'System Unavailable', className: 'runtime-status--degraded' };
    default:
      return { label: 'Checking system…', className: 'runtime-status--checking' };
  }
});
</script>

<template>
  <span class="runtime-status" :class="indicator.className" role="status">
    <span class="runtime-status__dot" aria-hidden="true" />
    {{ indicator.label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string; label?: string }>();

const tone = computed(() => {
  if (['SUCCESS', 'READY', 'ENABLED', 'INFO'].includes(props.status)) return 'positive';
  if (['FAILED', 'AUTH_EXPIRED', 'UNAVAILABLE', 'NOT_READY', 'ERROR'].includes(props.status))
    return 'danger';
  if (['RUNNING', 'RETRY_WAIT', 'WARN', 'DEGRADED', 'DELIVERY_UNKNOWN'].includes(props.status))
    return 'warning';
  return 'neutral';
});
</script>

<template>
  <span class="status-badge" :class="`status-badge--${tone}`">
    <span class="status-badge__dot" aria-hidden="true" />
    {{ label ?? status.replaceAll('_', ' ') }}
  </span>
</template>

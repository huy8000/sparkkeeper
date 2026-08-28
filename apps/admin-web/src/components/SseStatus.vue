<script setup lang="ts">
import { computed } from 'vue';

import { realtimeConnectionLabel } from '../api/realtimePolicy';
import type { RealtimeConnectionState } from '../types/api';

const props = defineProps<{ state: RealtimeConnectionState }>();

/**
 * SSE presentation rule: CONNECTED → "Live"; any reconnecting phase →
 * "Reconnecting". A dropped realtime link never blocks REST pages.
 */
const indicator = computed(() => {
  if (props.state === 'CONNECTED') {
    return { label: realtimeConnectionLabel(props.state), className: 'sse-status--live' };
  }
  if (props.state === 'DISCONNECTED') {
    return { label: realtimeConnectionLabel(props.state), className: 'sse-status--offline' };
  }
  return {
    label: realtimeConnectionLabel(props.state),
    className: 'sse-status--reconnecting',
  };
});
</script>

<template>
  <span class="sse-status" :class="indicator.className" role="status">
    <span class="sse-status__pulse" aria-hidden="true" />
    {{ indicator.label }}
  </span>
</template>

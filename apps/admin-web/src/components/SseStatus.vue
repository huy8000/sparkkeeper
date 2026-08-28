<script setup lang="ts">
import { computed } from 'vue';

import { realtimeConnectionKey } from '../api/realtimePolicy';
import { useTranslation } from '../i18n';
import type { RealtimeConnectionState } from '../types/api';

const props = defineProps<{ state: RealtimeConnectionState }>();

const { t } = useTranslation();

/**
 * SSE presentation rule: CONNECTED → "Live"; any reconnecting phase →
 * "Reconnecting". A dropped realtime link never blocks REST pages.
 */
const indicator = computed(() => {
  const label = t(realtimeConnectionKey(props.state));
  if (props.state === 'CONNECTED') {
    return { label, className: 'sse-status--live' };
  }
  if (props.state === 'DISCONNECTED') {
    return { label, className: 'sse-status--offline' };
  }
  return {
    label,
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

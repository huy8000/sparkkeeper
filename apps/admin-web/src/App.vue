<script setup lang="ts">
import { onBeforeUnmount, provide, readonly, ref, watch } from 'vue';

import { createSparkKeeperApi } from './api/sparkkeeperApi';
import { invalidatesRuntimeStatus } from './api/realtimeInvalidation';
import { REALTIME_REFRESH_DELAY_MS } from './api/realtimePolicy';
import { appContextKey } from './appContext';
import { useRequest } from './composables/useRequest';
import { useDebouncedAction } from './composables/useDebouncedAction';
import { useRealtimeEvents } from './composables/useRealtimeEvents';

const api = createSparkKeeperApi();
const refreshVersion = ref(0);
const runtime = useRequest((signal) => api.getRuntimeStatus(signal));
const realtime = useRealtimeEvents();
const runtimeInvalidation = useDebouncedAction(
  () => void runtime.load(),
  REALTIME_REFRESH_DELAY_MS,
);
const unsubscribeRealtime = realtime.subscribe((event) => {
  if (invalidatesRuntimeStatus(event)) runtimeInvalidation.trigger();
});
onBeforeUnmount(unsubscribeRealtime);

function refreshActivePage(): void {
  refreshVersion.value += 1;
  void runtime.load();
}

// One recovered connection produces one app-level snapshot generation. Active
// page resources decide how many relevant REST sections they own; individual
// SSE subscribers do not each implement their own reconnect cycle.
watch(realtime.reconnectGeneration, refreshActivePage, { flush: 'sync' });

provide(appContextKey, {
  api,
  refreshVersion: readonly(refreshVersion),
  runtime,
  realtime,
  refresh: refreshActivePage,
});
</script>

<template>
  <RouterView />
</template>

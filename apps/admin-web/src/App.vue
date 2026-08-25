<script setup lang="ts">
import { onBeforeUnmount, provide, readonly, ref } from 'vue';

import { createSparkKeeperApi } from './api/sparkkeeperApi';
import { invalidatesRuntimeStatus } from './api/realtimeInvalidation';
import { appContextKey } from './appContext';
import { useRequest } from './composables/useRequest';
import { useDebouncedAction } from './composables/useDebouncedAction';
import { useRealtimeEvents } from './composables/useRealtimeEvents';

const api = createSparkKeeperApi();
const refreshVersion = ref(0);
const runtime = useRequest((signal) => api.getRuntimeStatus(signal));
const realtime = useRealtimeEvents();
const runtimeInvalidation = useDebouncedAction(() => void runtime.load());
const unsubscribeRealtime = realtime.subscribe((event) => {
  if (invalidatesRuntimeStatus(event)) runtimeInvalidation.trigger();
});
onBeforeUnmount(unsubscribeRealtime);

provide(appContextKey, {
  api,
  refreshVersion: readonly(refreshVersion),
  runtime,
  realtime,
  refresh() {
    refreshVersion.value += 1;
    void runtime.load();
  },
});
</script>

<template>
  <RouterView />
</template>

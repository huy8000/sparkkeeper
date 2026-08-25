<script setup lang="ts">
import { provide, readonly, ref } from 'vue';

import { createSparkKeeperApi } from './api/sparkkeeperApi';
import { appContextKey } from './appContext';
import { useRequest } from './composables/useRequest';

const api = createSparkKeeperApi();
const refreshVersion = ref(0);
const runtime = useRequest((signal) => api.getRuntimeStatus(signal));

provide(appContextKey, {
  api,
  refreshVersion: readonly(refreshVersion),
  runtime,
  refresh() {
    refreshVersion.value += 1;
    void runtime.load();
  },
});
</script>

<template>
  <RouterView />
</template>

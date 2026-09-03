<script setup lang="ts">
import { onBeforeUnmount, provide, readonly, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { createSparkKeeperApi, type SparkKeeperApi } from './api/sparkkeeperApi';
import { invalidatesRuntimeStatus } from './api/realtimeInvalidation';
import { REALTIME_REFRESH_DELAY_MS } from './api/realtimePolicy';
import { appContextKey } from './appContext';
import { createAuthController } from './auth/AuthController';
import { installAuthNavigationGuard, redirectAfterSessionLoss } from './router';
import { useRequest } from './composables/useRequest';
import { useDebouncedAction } from './composables/useDebouncedAction';
import { useRealtimeEvents } from './composables/useRealtimeEvents';

const router = useRouter();

let api!: SparkKeeperApi;
const auth = createAuthController(() => api);

api = createSparkKeeperApi({
  csrfTokenProvider: () => auth.getCsrfToken(),
  onUnauthenticated: (error) => {
    auth.handleSessionLoss(error.code);
  },
});

const refreshVersion = ref(0);
const runtime = useRequest((signal) => api.getRuntimeStatus(signal), { immediate: false });
const realtime = useRealtimeEvents(undefined, false);

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
  if (auth.isAuthenticated()) {
    void runtime.load();
  }
}

watch(realtime.reconnectGeneration, refreshActivePage, { flush: 'sync' });

watch(
  auth.state,
  (state) => {
    if (state === 'AUTHENTICATED') {
      void runtime.load();
      realtime.connect();
    } else if (state === 'UNAUTHENTICATED') {
      // Runtime lifecycle only. The login redirect itself is the router
      // module's canonical policy (single owner); App.vue only triggers it.
      runtime.reset();
      realtime.disconnect();
      if (router) {
        redirectAfterSessionLoss(router, router.currentRoute.value.fullPath);
      }
    }
  },
  { immediate: true },
);

// Initial bootstrap check. The canonical navigation guard (installAuthNavigationGuard,
// registered below on the app router) is the single owner of route gating; App.vue
// owns only the bootstrapping/error barrier UI.
void auth.bootstrap();

installAuthNavigationGuard(router, auth);

provide(appContextKey, {
  api,
  auth,
  refreshVersion: readonly(refreshVersion),
  runtime,
  realtime,
  refresh: refreshActivePage,
});
</script>

<template>
  <div
    v-if="auth.state.value === 'BOOTSTRAPPING'"
    class="auth-barrier-loading"
    role="status"
    aria-label="Checking administrator authentication…"
  />
  <div
    v-else-if="auth.state.value === 'ERROR' && router?.currentRoute.value.meta.public !== true"
    class="auth-barrier-error page"
  >
    <div class="card page-error" role="alert">
      <h2>Unable to reach authentication service</h2>
      <p>A network or server error occurred while verifying your session.</p>
      <button class="button button--primary" type="button" @click="() => void auth.bootstrap()">
        Retry
      </button>
    </div>
  </div>
  <RouterView v-else />
</template>

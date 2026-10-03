<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { useAdminApp } from '../appContext';
import { createTaskApi } from '../api/taskApi';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { useApiErrorText } from '../composables/useApiErrorText';
const route = useRoute(),
  app = useAdminApp(),
  { t } = useTranslation(),
  { apiErrorText } = useApiErrorText();
const id = computed(() => String(route.params.runId));
const api = createTaskApi({
  csrfTokenProvider: app.auth.getCsrfToken,
  onUnauthenticated: () => app.auth.handleSessionLoss(),
});
const run = useRequest((signal) => api.run(id.value, signal));
watch(id, () => {
  run.reset();
  void run.load();
});
onBeforeUnmount(() => run.cancel());
</script>
<template>
  <section class="page-stack">
    <h2>{{ t('tasks.run') }}</h2>
    <p>{{ t('tasks.noRetry') }}</p>
    <button @click="run.load()">{{ t('common.refresh') }}</button>
    <p v-if="run.error.value" role="alert">{{ apiErrorText(run.error.value) }}</p>
    <template v-if="run.data.value"
      ><p>{{ run.data.value.businessDate }} · {{ run.data.value.status }}</p>
      <p v-for="r in run.data.value.records" :key="r.id">
        {{ r.contactId }} · {{ r.machineStatus }} · {{ r.failureCode }} · {{ r.attemptCount }}
      </p></template
    >
  </section>
</template>

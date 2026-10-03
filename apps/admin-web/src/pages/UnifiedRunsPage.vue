<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAdminApp } from '../appContext';
import { createMigrationApi } from '../api/migrationApi';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { invalidatesRunList } from '../api/realtimeInvalidation';
const { t } = useTranslation();
const props = defineProps<{ accountId?: string }>();
const app = useAdminApp(),
  api = createMigrationApi({
    csrfTokenProvider: app.auth.getCsrfToken,
    onUnauthenticated: () => app.auth.handleSessionLoss(),
  });
const offset = ref(0),
  runs = useRequest((signal) => api.runs(offset.value, props.accountId, signal));
watch(
  () => props.accountId,
  () => {
    offset.value = 0;
    runs.reset();
    void runs.load();
  },
);
watch(app.refreshVersion, () => void runs.load());
useRealtimeRefresh(app.realtime, invalidatesRunList, () => void runs.load());
function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta);
  void runs.load();
}
</script>
<template>
  <div class="page-stack">
    <header class="page-heading">
      <h2>{{ t('v410.history') }}</h2>
      <button @click="runs.load()">{{ t('common.refresh') }}</button>
    </header>
    <p>{{ t('v410.historyNote') }}</p>
    <p v-if="runs.error.value" role="alert">{{ t('v410.readError') }}</p>
    <p v-if="runs.loading.value" role="status">{{ t('v410.loading') }}</p>
    <p v-if="runs.data.value?.length === 0">{{ t('v410.empty') }}</p>
    <div class="table-wrap">
      <table v-if="runs.data.value">
        <thead>
          <tr>
            <th>{{ t('v410.source') }}</th>
            <th>{{ t('v410.account') }}</th>
            <th>{{ t('v410.date') }}</th>
            <th>{{ t('v410.status') }}</th>
            <th>{{ t('v410.detail') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in runs.data.value" :key="`${r.source}:${r.id}`">
            <td>{{ r.source }} / {{ r.kind }}</td>
            <td>{{ r.accountId }}</td>
            <td>{{ r.businessDate ?? t('v410.single') }}</td>
            <td>{{ r.status }}</td>
            <td>
              <RouterLink :to="`/history/${r.id}`">{{ t('v410.view') }}</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div>
      <button :disabled="offset === 0 || runs.loading.value" @click="page(-50)">
        {{ t('v410.previous') }}</button
      ><button :disabled="runs.data.value?.length !== 50 || runs.loading.value" @click="page(50)">
        {{ t('v410.next') }}
      </button>
    </div>
  </div>
</template>

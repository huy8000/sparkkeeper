<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAdminApp } from '../appContext';
import { createMigrationApi } from '../api/migrationApi';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { invalidatesRunDetail } from '../api/realtimeInvalidation';
import type { UnifiedSendRecord, ResolutionSummary } from '@sparkkeeper/shared';
const { t } = useTranslation();
const route = useRoute(),
  app = useAdminApp(),
  api = createMigrationApi({
    csrfTokenProvider: app.auth.getCsrfToken,
    onUnauthenticated: () => app.auth.handleSessionLoss(),
  });
const id = computed(() => String(route.params.runId)),
  offset = ref(0),
  run = useRequest((s) => api.run(id.value, s)),
  records = useRequest((s) => api.records(id.value, offset.value, s));
useRealtimeRefresh(
  app.realtime,
  (e) =>
    invalidatesRunDetail(e, id.value) ||
    (e.type === 'CONFIG_CHANGED' &&
      e.data.entityType === 'DELIVERY_RESOLUTION' &&
      (records.data.value ?? []).some((r) => r.id === e.data.entityId)),
  () => {
    void run.load();
    void records.load();
  },
);
const value = ref<ResolutionSummary['resolution']>('INCONCLUSIVE'),
  note = ref(''),
  confirmed = ref(false),
  busy = ref(false),
  error = ref(''),
  history = ref<ResolutionSummary[]>([]);
watch(id, () => {
  offset.value = 0;
  confirmed.value = false;
  note.value = '';
  history.value = [];
  run.reset();
  records.reset();
  void run.load();
  void records.load();
});
async function resolve(r: UnifiedSendRecord) {
  if (busy.value || !confirmed.value || r.status !== 'DELIVERY_UNKNOWN') return;
  busy.value = true;
  error.value = '';
  try {
    await api.resolve(r, value.value, note.value);
    note.value = '';
    confirmed.value = false;
    await records.load();
    history.value = (await api.resolutions(r.id)).items;
  } catch {
    error.value = 'v410.mutationError';
  } finally {
    busy.value = false;
  }
}
async function show(r: UnifiedSendRecord) {
  try {
    history.value = (await api.resolutions(r.id)).items;
  } catch {
    error.value = 'v410.readError';
  }
}
function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta);
  void records.load();
}
</script>
<template>
  <div class="page-stack">
    <header class="page-heading">
      <h2>{{ t('v410.runDetail') }}</h2>
      <button
        @click="
          run.load();
          records.load();
        "
      >
        {{ t('common.refresh') }}
      </button>
    </header>
    <p v-if="run.data.value">
      {{ run.data.value.source }} / {{ run.data.value.kind }} — {{ run.data.value.status }}
    </p>
    <p v-if="run.error.value || records.error.value" role="alert">{{ t('v410.readError') }}</p>
    <p>{{ t('v410.historyNote') }}</p>
    <label
      >{{ t('v410.conclusion')
      }}<select v-model="value">
        <option value="INCONCLUSIVE">{{ t('v410.inconclusive') }}</option>
        <option value="CONFIRMED_DELIVERED">{{ t('v410.delivered') }}</option>
        <option value="CONFIRMED_NOT_DELIVERED">{{ t('v410.notDelivered') }}</option>
      </select></label
    ><label>{{ t('v410.note') }}<textarea v-model="note" maxlength="500" /></label
    ><label
      ><input v-model="confirmed" type="checkbox" :disabled="busy" />{{
        t('v410.confirmResolution')
      }}</label
    >
    <p v-if="error" role="alert">{{ t(error) }}</p>
    <div v-for="r in records.data.value ?? []" :key="r.id">
      <p>
        {{ r.friendId ?? r.contactId }} — {{ r.status }} — HUMAN:
        {{ r.latestResolution?.resolution ?? t('v410.none') }}
      </p>
      <button :disabled="busy || !confirmed || r.status !== 'DELIVERY_UNKNOWN'" @click="resolve(r)">
        {{ t('v410.append') }}</button
      ><button @click="show(r)">{{ t('v410.humanHistory') }}</button>
    </div>
    <button :disabled="offset === 0" @click="page(-50)">{{ t('v410.previous') }}</button
    ><button :disabled="records.data.value?.length !== 50" @click="page(50)">
      {{ t('v410.next') }}
    </button>
    <ol>
      <li v-for="r in history" :key="r.id">
        {{ r.resolvedAt }} — {{ r.resolution }} — {{ r.note }}
      </li>
    </ol>
  </div>
</template>

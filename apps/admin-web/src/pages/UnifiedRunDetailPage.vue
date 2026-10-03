<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAdminApp } from '../appContext';
import { createMigrationApi } from '../api/migrationApi';
import { useRequest } from '../composables/useRequest';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { invalidatesRunDetail } from '../api/realtimeInvalidation';
import type { UnifiedSendRecord, ResolutionSummary } from '@sparkkeeper/shared';
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
    error.value = '操作被拒绝或版本已变化。请刷新并重新登录后确认；不会自动重试。';
  } finally {
    busy.value = false;
  }
}
async function show(r: UnifiedSendRecord) {
  try {
    history.value = (await api.resolutions(r.id)).items;
  } catch {
    error.value = '人工记录读取失败。';
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
      <h2>统一 Run 详情</h2>
      <button
        @click="
          run.load();
          records.load();
        "
      >
        刷新
      </button>
    </header>
    <p v-if="run.data.value">
      {{ run.data.value.source }} / {{ run.data.value.kind }} — {{ run.data.value.status }}
    </p>
    <p v-if="run.error.value || records.error.value" role="alert">读取失败，请刷新。</p>
    <p>机器结果不可修改。人工确认不会重发；UNKNOWN 不会自动 retry。</p>
    <label
      >人工结论<select v-model="value">
        <option value="INCONCLUSIVE">仍无法确定</option>
        <option value="CONFIRMED_DELIVERED">人工确认已送达</option>
        <option value="CONFIRMED_NOT_DELIVERED">人工确认未送达</option>
      </select></label
    ><label
      >说明（最多500字；不要粘贴聊天、身份、cookie/token/密码）<textarea
        v-model="note"
        maxlength="500"
      /></label
    ><label
      ><input
        v-model="confirmed"
        type="checkbox"
        :disabled="busy"
      />我已确认仅追加人工记录，不重发。</label
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-for="r in records.data.value ?? []" :key="r.id">
      <p>
        {{ r.friendId ?? r.contactId }} — {{ r.status }} — HUMAN:
        {{ r.latestResolution?.resolution ?? '无' }}
      </p>
      <button :disabled="busy || !confirmed || r.status !== 'DELIVERY_UNKNOWN'" @click="resolve(r)">
        追加人工 resolution</button
      ><button @click="show(r)">人工记录</button>
    </div>
    <button :disabled="offset === 0" @click="page(-50)">上一页</button
    ><button :disabled="records.data.value?.length !== 50" @click="page(50)">下一页</button>
    <ol>
      <li v-for="r in history" :key="r.id">
        {{ r.resolvedAt }} — {{ r.resolution }} — {{ r.note }}
      </li>
    </ol>
  </div>
</template>

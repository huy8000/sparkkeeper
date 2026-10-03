<script setup lang="ts">
import { ref } from 'vue';
import { useAdminApp } from '../appContext';
import { createMigrationApi } from '../api/migrationApi';
import { useRequest } from '../composables/useRequest';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { invalidatesRunList } from '../api/realtimeInvalidation';
const app = useAdminApp(),
  api = createMigrationApi({
    csrfTokenProvider: app.auth.getCsrfToken,
    onUnauthenticated: () => app.auth.handleSessionLoss(),
  });
const offset = ref(0),
  runs = useRequest(() => api.runs(offset.value));
useRealtimeRefresh(app.realtime, invalidatesRunList, () => void runs.load());
function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta);
  void runs.load();
}
</script>
<template>
  <div class="page-stack">
    <header class="page-heading">
      <h2>Run 历史 — Legacy / V4</h2>
      <button @click="runs.load()">刷新</button>
    </header>
    <p>保留原始机器结果。人工 resolution 仅追加说明，不会重发或更改 SUCCESS/DELIVERY_UNKNOWN。</p>
    <p v-if="runs.error.value" role="alert">读取失败，请刷新。</p>
    <table v-if="runs.data.value">
      <thead>
        <tr>
          <th>来源 / kind</th>
          <th>账号</th>
          <th>日期</th>
          <th>机器状态</th>
          <th>详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in runs.data.value" :key="`${r.source}:${r.id}`">
          <td>{{ r.source }} / {{ r.kind }}</td>
          <td>{{ r.accountId }}</td>
          <td>{{ r.businessDate ?? '单次 Test Send' }}</td>
          <td>{{ r.status }}</td>
          <td><RouterLink :to="`/history/${r.id}`">查看</RouterLink></td>
        </tr>
      </tbody>
    </table>
    <div>
      <button :disabled="offset === 0 || runs.loading.value" @click="page(-50)">上一页</button
      ><button :disabled="runs.data.value?.length !== 50 || runs.loading.value" @click="page(50)">
        下一页
      </button>
    </div>
  </div>
</template>

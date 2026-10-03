<script setup lang="ts">
import { useAdminApp } from '../appContext';
import { createMigrationApi } from '../api/migrationApi';
import { useRequest } from '../composables/useRequest';
const app = useAdminApp(),
  api = createMigrationApi({
    csrfTokenProvider: app.auth.getCsrfToken,
    onUnauthenticated: () => app.auth.handleSessionLoss(),
  }),
  events = useRequest(() => api.audits());
</script>
<template>
  <div class="page-stack">
    <header class="page-heading">
      <h2>Audit（最近50条）</h2>
      <button @click="events.load()">刷新</button>
    </header>
    <p v-if="events.error.value" role="alert">读取失败。</p>
    <table>
      <thead>
        <tr>
          <th>时间</th>
          <th>动作</th>
          <th>对象</th>
          <th>结果</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in events.data.value?.items ?? []" :key="String(r.id)">
          <td>{{ r.createdAt }}</td>
          <td>{{ r.action }}</td>
          <td>{{ r.entityType }} / {{ r.entityId }}</td>
          <td>{{ r.outcome }}</td>
        </tr>
      </tbody>
    </table>
    <p>Audit/history/resolution 不自动删除。事件不含正文、身份值、profile 路径或凭据。</p>
  </div>
</template>

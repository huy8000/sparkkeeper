<script setup lang="ts">
import { useAdminApp } from '../appContext';
import { createMigrationApi } from '../api/migrationApi';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
const { t } = useTranslation();
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
      <h2>{{ t('v410.auditTitle') }}</h2>
      <button @click="events.load()">{{ t('common.refresh') }}</button>
    </header>
    <p v-if="events.error.value" role="alert">{{ t('v410.readError') }}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('v410.time') }}</th>
            <th>{{ t('v410.action') }}</th>
            <th>{{ t('v410.entity') }}</th>
            <th>{{ t('v410.outcome') }}</th>
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
    </div>
    <p>{{ t('v410.auditNote') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useAdminApp } from '../appContext';
import { createTaskApi } from '../api/taskApi';
import { useRequest } from '../composables/useRequest';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useTranslation } from '../i18n';
import UnifiedRunsPage from './UnifiedRunsPage.vue';
const app = useAdminApp(),
  { t } = useTranslation();
const options = {
  csrfTokenProvider: app.auth.getCsrfToken,
  onUnauthenticated: () => app.auth.handleSessionLoss(),
};
const accounts = useRequest((s) => app.api.listAccounts(s)),
  tasks = useRequest((s) => createTaskApi(options).list(undefined, s));
const attention = computed(
  () =>
    accounts.data.value?.filter((a) => a.loginStatus !== 'READY' || a.profileState !== 'READY') ??
    [],
);
function refresh() {
  void accounts.load();
  void tasks.load();
}
watch(app.refreshVersion, refresh);
useRealtimeRefresh(
  app.realtime,
  (e) => e.type === 'CONFIG_CHANGED' || e.type === 'RUNTIME_EVENT',
  refresh,
);
</script>
<template>
  <div class="page-stack overview-page">
    <header class="overview-hero">
      <div>
        <p class="eyebrow">SparkKeeper</p>
        <h2>{{ t('v410.overview') }}</h2>
        <p>{{ t('v410.overviewNote') }}</p>
      </div>
    </header>
    <p role="status">{{ t('v410.locked') }}</p>
    <p v-if="accounts.error.value || tasks.error.value" role="alert">{{ t('v410.readError') }}</p>
    <p v-if="accounts.refreshError.value || tasks.refreshError.value" role="status">
      {{ t('common.staleData') }}
    </p>
    <p v-if="accounts.loading.value || tasks.loading.value" role="status">
      {{ t('v410.loading') }}
    </p>
    <div class="account-summary-grid">
      <section class="account-summary-card">
        <h3>{{ t('nav.accounts') }}</h3>
        <strong>{{ accounts.data.value?.length ?? '—' }}</strong
        ><RouterLink to="/accounts">{{ t('v410.view') }}</RouterLink>
      </section>
      <section class="account-summary-card">
        <h3>{{ t('tasks.title') }}</h3>
        <strong>{{ tasks.data.value?.items.length ?? '—' }}</strong
        ><RouterLink to="/tasks">{{ t('v410.view') }}</RouterLink>
      </section>
      <section class="account-summary-card">
        <h3>{{ t('nav.system') }}</h3>
        <span>{{ t('tasks.master') }}: {{ tasks.data.value?.masterOpen ?? '—' }}</span
        ><span>{{ t('tasks.released') }}: {{ tasks.data.value?.released ?? '—' }}</span
        ><RouterLink to="/operations/system">{{ t('v410.view') }}</RouterLink>
      </section>
    </div>
    <section class="panel">
      <h3>{{ t('v410.attention') }}</h3>
      <p v-if="accounts.data.value && !attention.length">{{ t('v410.empty') }}</p>
      <ul>
        <li v-for="a in attention" :key="a.id">
          <RouterLink :to="`/accounts/${a.id}/overview`">{{ a.name }}</RouterLink> —
          {{ a.profileState }} / {{ a.loginStatus }}
        </li>
      </ul>
    </section>
    <UnifiedRunsPage />
  </div>
</template>

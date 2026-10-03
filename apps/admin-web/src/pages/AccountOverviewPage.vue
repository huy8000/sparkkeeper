<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import { createContactsApi } from '../api/contactApi';
import { createTaskApi } from '../api/taskApi';
import { useRequest } from '../composables/useRequest';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useTranslation } from '../i18n';
import { ApiError } from '../api/client';
import { useApiErrorText } from '../composables/useApiErrorText';
const app = useAdminApp(),
  router = useRouter(),
  workspace = useAccountWorkspace(),
  { t } = useTranslation(),
  { apiErrorText } = useApiErrorText();
const reloginBusy = ref(false);
const reloginError = ref<ApiError | null>(null);
const reloginKey = ref<string | null>(null);

async function startRelogin(): Promise<void> {
  if (reloginBusy.value) return;
  reloginBusy.value = true;
  reloginError.value = null;
  reloginKey.value ??= globalThis.crypto.randomUUID();
  try {
    const result = await app.api.startAccountLogin(
      { purpose: 'RELOGIN', accountId: workspace.accountId.value },
      reloginKey.value,
    );
    await router.push(`/account-login-sessions/${result.session.id}`);
  } catch (error) {
    reloginError.value =
      error instanceof ApiError
        ? error
        : new ApiError('UNEXPECTED_ERROR', t('common.unexpectedError'), 0, 'MALFORMED');
    if (reloginError.value.kind === 'NETWORK') {
      const active = await app.api.getActiveAccountLogin().catch(() => null);
      if (active?.session?.accountId === workspace.accountId.value) {
        await router.push(`/account-login-sessions/${active.session.id}`);
      }
    }
  } finally {
    reloginBusy.value = false;
  }
}

const options = {
  csrfTokenProvider: app.auth.getCsrfToken,
  onUnauthenticated: () => app.auth.handleSessionLoss(),
};
const contacts = useRequest((s) =>
  createContactsApi(options).list(workspace.accountId.value, { limit: '200' }, s),
);
const tasks = useRequest((s) => createTaskApi(options).list(workspace.accountId.value, s));
function refresh() {
  void contacts.load();
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
  <div class="page-stack account-tab-page">
    <header class="account-tab-heading">
      <h3>{{ t('nav.overview') }}</h3>
      <button
        class="button button--secondary"
        :disabled="reloginBusy || workspace.account.data.value?.lifecycleStatus !== 'ACTIVE'"
        @click="startRelogin"
      >
        {{ t('accountLogin.relogin') }}
      </button>
    </header>
    <p v-if="reloginError" role="alert">{{ apiErrorText(reloginError) }}</p>
    <section class="account-readiness-card">
      <h3>{{ t('v410.profile') }}</h3>
      <p>
        {{ workspace.account.data.value?.profileState }} /
        {{ workspace.account.data.value?.loginStatus }} /
        {{ workspace.account.data.value?.lifecycleStatus }}
      </p>
      <p>{{ t('v410.locked') }}</p>
    </section>
    <p v-if="contacts.error.value || tasks.error.value" role="alert">{{ t('v410.readError') }}</p>
    <div class="account-summary-grid">
      <section class="account-summary-card">
        <h3>{{ t('contacts.title') }} (≤200)</h3>
        <strong>{{ contacts.data.value?.items.length ?? '—' }}</strong
        ><RouterLink :to="`/accounts/${workspace.accountId.value}/contacts`">{{
          t('v410.view')
        }}</RouterLink>
      </section>
      <section class="account-summary-card">
        <h3>{{ t('tasks.title') }}</h3>
        <strong>{{ tasks.data.value?.items.length ?? '—' }}</strong
        ><RouterLink :to="`/accounts/${workspace.accountId.value}/tasks`">{{
          t('v410.view')
        }}</RouterLink>
      </section>
      <section class="account-summary-card">
        <h3>{{ t('account.historyTab') }}</h3>
        <RouterLink :to="`/accounts/${workspace.accountId.value}/history`">{{
          t('v410.view')
        }}</RouterLink>
      </section>
    </div>
  </div>
</template>

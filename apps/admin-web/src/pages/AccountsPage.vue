<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAdminApp } from '../appContext';
import AuthStatusBadge from '../components/AuthStatusBadge.vue';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useRequest } from '../composables/useRequest';
import { useApiErrorText } from '../composables/useApiErrorText';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useTranslation } from '../i18n';
import { formatTimestamp } from '../utils/format';
import { ApiError } from '../api/client';

const app = useAdminApp();
const router = useRouter();
const { t } = useTranslation();
const { apiErrorText } = useApiErrorText();
const accounts = useRequest((signal) => app.api.listAccounts(signal));
const active = useRequest((signal) => app.api.getActiveAccountLogin(signal));
const submitting = ref(false);
const startError = ref<ApiError | null>(null);
const idempotencyKey = ref<string | null>(null);
watch(app.refreshVersion, () => void accounts.load());
useRealtimeRefresh(
  app.realtime,
  (event) => event.type === 'CONFIG_CHANGED' && event.data.entityType === 'ACCOUNT',
  () => void accounts.load(),
);

async function startAddAccount(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  startError.value = null;
  idempotencyKey.value ??= globalThis.crypto.randomUUID();
  try {
    const result = await app.api.startAccountLogin(
      { purpose: 'ADD_ACCOUNT' },
      idempotencyKey.value,
    );
    await router.push(`/account-login-sessions/${result.session.id}`);
  } catch (error) {
    startError.value =
      error instanceof ApiError
        ? error
        : new ApiError('UNEXPECTED_ERROR', t('common.unexpectedError'), 0, 'MALFORMED');
    if (startError.value.kind === 'NETWORK') {
      await active.load();
      if (active.data.value?.session) {
        await router.push(`/account-login-sessions/${active.data.value.session.id}`);
      }
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">{{ t('nav.accounts') }}</p>
        <h2>{{ t('accountsPage.title') }}</h2>
        <p>{{ t('accountsPage.subtitle') }}</p>
      </div>
      <div class="page-actions">
        <button
          class="button button--primary"
          type="button"
          :disabled="submitting || Boolean(active.data.value?.session)"
          @click="startAddAccount"
        >
          {{ t('accountLogin.add') }}
        </button>
        <button class="button button--secondary" type="button" @click="accounts.load">
          {{ t('common.refresh') }}
        </button>
      </div>
    </header>
    <BackgroundRefreshIndicator v-if="accounts.refreshing.value" />
    <StaleDataNotice
      v-if="accounts.refreshError.value"
      :error="accounts.refreshError.value"
      @retry="accounts.load"
    />
    <p v-if="startError" class="error-message" role="alert">{{ apiErrorText(startError) }}</p>
    <p v-if="active.data.value?.session" class="notice" role="status">
      {{ t('accountLogin.activeNotice') }}
      <RouterLink :to="`/account-login-sessions/${active.data.value.session.id}`">{{
        t('accountLogin.viewSession')
      }}</RouterLink>
    </p>
    <LoadingState v-if="accounts.initialLoading.value" :label="t('accountsPage.loading')" />
    <ErrorState
      v-else-if="accounts.initialError.value"
      :error="accounts.initialError.value"
      @retry="accounts.load"
    />
    <EmptyState
      v-else-if="accounts.data.value?.length === 0"
      :title="t('accountsPage.emptyTitle')"
      :description="t('accountsPage.emptyDescription')"
    />
    <div v-else-if="accounts.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('accountsPage.columnName') }}</th>
            <th>{{ t('accountsPage.columnEnabled') }}</th>
            <th>{{ t('accountsPage.columnLoginStatus') }}</th>
            <th>{{ t('accountsPage.columnUpdated') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="account in accounts.data.value" :key="account.id">
            <td>
              <RouterLink class="table-link" :to="`/accounts/${account.id}/overview`">{{
                account.name
              }}</RouterLink>
            </td>
            <td><StatusBadge :status="account.enabled ? 'ENABLED' : 'DISABLED'" /></td>
            <td><AuthStatusBadge :status="account.loginStatus" /></td>
            <td>{{ formatTimestamp(account.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

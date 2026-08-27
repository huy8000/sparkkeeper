<script setup lang="ts">
import { ref, watch } from 'vue';

import { useAdminApp } from '../appContext';
import AccountForm from '../components/AccountForm.vue';
import AuthStatusBadge from '../components/AuthStatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FormPanel from '../components/FormPanel.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';
import { useMutation } from '../composables/useMutation';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { formatTimestamp } from '../utils/format';
import type { CreateAccountInput } from '../types/api';

const app = useAdminApp();
const accounts = useRequest((signal) => app.api.listAccounts(signal));
const creating = ref(false);
const {
  submitting,
  error: formError,
  success: successMessage,
  execute,
  clearError,
} = useMutation();
watch(app.refreshVersion, () => void accounts.load());
useRealtimeRefresh(
  app.realtime,
  (event) => event.type === 'CONFIG_CHANGED' && event.data.entityType === 'ACCOUNT',
  () => void accounts.load(),
);

async function createAccount(input: CreateAccountInput): Promise<void> {
  await execute(
    () => app.api.createAccount(input),
    async () => {
      creating.value = false;
      await accounts.load();
    },
    'Account configuration saved.',
  );
}

function closeForm(): void {
  creating.value = false;
  clearError();
}
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Accounts</p>
        <h2>Configured accounts</h2>
        <p>View account metadata and login state.</p>
      </div>
      <div class="page-actions">
        <button class="button button--primary" type="button" @click="creating = true">
          Create account
        </button>
        <button class="button button--secondary" type="button" @click="accounts.load">
          Refresh
        </button>
      </div>
    </header>
    <p v-if="successMessage" class="success-message" role="status">{{ successMessage }}</p>
    <FormPanel
      v-if="creating"
      title="Create account"
      description="Configure a local account record."
      @cancel="closeForm"
    >
      <AccountForm
        :submitting="submitting"
        :server-error="formError"
        @submit="createAccount"
        @cancel="closeForm"
      />
    </FormPanel>
    <LoadingState v-if="accounts.loading.value && !accounts.data.value" label="Loading accounts…" />
    <ErrorState
      v-else-if="accounts.error.value"
      :message="accounts.error.value.message"
      @retry="accounts.load"
    />
    <EmptyState
      v-else-if="accounts.data.value?.length === 0"
      title="No accounts"
      description="No accounts are available in the current database."
    />
    <div v-else-if="accounts.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Enabled</th>
            <th>Login status</th>
            <th>Updated</th>
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

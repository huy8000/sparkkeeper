<script setup lang="ts">
import { watch } from 'vue';

import { useAdminApp } from '../appContext';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import IdentifierValue from '../components/IdentifierValue.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const accounts = useRequest((signal) => app.api.listAccounts(signal));
watch(app.refreshVersion, () => void accounts.load());
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Accounts</p>
        <h2>Configured accounts</h2>
        <p>View account metadata and login state.</p>
      </div>
      <button class="button button--secondary" type="button" @click="accounts.load">Refresh</button>
    </header>
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
            <th>Identifier</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="account in accounts.data.value" :key="account.id">
            <td>
              <RouterLink class="table-link" :to="`/accounts/${account.id}`">{{
                account.name
              }}</RouterLink>
            </td>
            <td><StatusBadge :status="account.enabled ? 'ENABLED' : 'DISABLED'" /></td>
            <td><StatusBadge :status="account.loginStatus" /></td>
            <td><IdentifierValue :value="account.id" compact /></td>
            <td>{{ formatTimestamp(account.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

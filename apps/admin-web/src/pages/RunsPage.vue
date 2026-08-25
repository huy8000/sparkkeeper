<script setup lang="ts">
import { reactive, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAdminApp } from '../appContext';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';
import type { DailyRunStatus, RunFilters } from '../types/api';
import { formatTimestamp, shortId } from '../utils/format';

const RUN_STATUSES: readonly DailyRunStatus[] = [
  'READY',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'AUTH_EXPIRED',
];
const app = useAdminApp();
const router = useRouter();
const filters = reactive({
  accountId: '',
  businessDate: '',
  status: '' as DailyRunStatus | '',
  limit: 50 as 25 | 50 | 100,
});

function currentFilters(): RunFilters {
  return {
    ...(filters.accountId === '' ? {} : { accountId: filters.accountId }),
    ...(filters.businessDate === '' ? {} : { businessDate: filters.businessDate }),
    ...(filters.status === '' ? {} : { status: filters.status }),
    limit: filters.limit,
  };
}

const result = useRequest(async (signal) => {
  const [accounts, runs] = await Promise.all([
    app.api.listAccounts(signal),
    app.api.listRuns(currentFilters(), signal),
  ]);
  return { accounts, runs };
});
watch(app.refreshVersion, () => void result.load());

async function applyFilters(): Promise<void> {
  await router.replace({
    query: {
      ...(filters.accountId === '' ? {} : { accountId: filters.accountId }),
      ...(filters.businessDate === '' ? {} : { businessDate: filters.businessDate }),
      ...(filters.status === '' ? {} : { status: filters.status }),
      limit: String(filters.limit),
    },
  });
  await result.load();
}

function accountName(accountId: string): string {
  return result.data.value?.accounts.find((account) => account.id === accountId)?.name ?? accountId;
}
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Runs</p>
        <h2>Daily run history</h2>
        <p>Filter bounded, read-only execution history.</p>
      </div>
      <button class="button button--secondary" type="button" @click="result.load">Refresh</button>
    </header>
    <form class="filter-bar" aria-label="Run filters" @submit.prevent="applyFilters">
      <label
        >Account<select v-model="filters.accountId">
          <option value="">All accounts</option>
          <option
            v-for="account in result.data.value?.accounts ?? []"
            :key="account.id"
            :value="account.id"
          >
            {{ account.name }}
          </option>
        </select></label
      >
      <label>Business date<input v-model="filters.businessDate" type="date" /></label>
      <label
        >Status<select v-model="filters.status">
          <option value="">All statuses</option>
          <option v-for="status in RUN_STATUSES" :key="status" :value="status">
            {{ status.replaceAll('_', ' ') }}
          </option>
        </select></label
      >
      <label
        >Limit<select v-model.number="filters.limit">
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select></label
      >
      <button class="button button--primary" type="submit">Apply filters</button>
    </form>
    <LoadingState v-if="result.loading.value && !result.data.value" label="Loading runs…" />
    <ErrorState
      v-else-if="result.error.value"
      :message="result.error.value.message"
      @retry="result.load"
    />
    <EmptyState
      v-else-if="result.data.value?.runs.length === 0"
      title="No runs"
      description="No runs match the current filters."
    />
    <div v-else-if="result.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Business date</th>
            <th>Account</th>
            <th>Status</th>
            <th>Started</th>
            <th>Finished</th>
            <th>Run ID</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in result.data.value.runs" :key="run.id">
            <td>{{ run.businessDate }}</td>
            <td>{{ accountName(run.accountId) }}</td>
            <td><StatusBadge :status="run.status" /></td>
            <td>{{ formatTimestamp(run.startedAt) }}</td>
            <td>{{ formatTimestamp(run.finishedAt) }}</td>
            <td>
              <RouterLink
                class="table-link identifier-link"
                :to="`/runs/${run.id}`"
                :title="run.id"
              >
                <code>{{ shortId(run.id) }}</code>
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

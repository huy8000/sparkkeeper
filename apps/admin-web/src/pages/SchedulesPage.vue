<script setup lang="ts">
import { computed, watch } from 'vue';

import { useAdminApp } from '../appContext';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';

const app = useAdminApp();
const result = useRequest(async (signal) => {
  const accounts = await app.api.listAccounts(signal);
  const groupedSchedules = await Promise.all(
    accounts.map(async (account) => ({
      account,
      schedules: await app.api.listSchedules(account.id, signal),
    })),
  );
  return groupedSchedules.flatMap(({ account, schedules }) =>
    schedules.map((schedule) => ({ schedule, accountName: account.name })),
  );
});
const runtimeSchedulerLabel = computed(() =>
  app.runtime.data.value?.schedulerEnabled ? 'ENABLED' : 'DISABLED',
);
watch(app.refreshVersion, () => void result.load());
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Schedules</p>
        <h2>Account schedule windows</h2>
        <p>Schedule configuration is distinct from the runtime scheduler control.</p>
      </div>
      <button class="button button--secondary" type="button" @click="result.load">Refresh</button>
    </header>
    <section class="notice-card">
      <span>Runtime scheduler</span>
      <StatusBadge v-if="app.runtime.data.value" :status="runtimeSchedulerLabel" />
      <span v-else>Unavailable</span>
      <small>Each row below independently reports whether that schedule is enabled.</small>
    </section>
    <LoadingState v-if="result.loading.value && !result.data.value" label="Loading schedules…" />
    <ErrorState
      v-else-if="result.error.value"
      :message="result.error.value.message"
      @retry="result.load"
    />
    <EmptyState
      v-else-if="result.data.value?.length === 0"
      title="No schedules"
      description="No account schedules are available."
    />
    <div v-else-if="result.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Window</th>
            <th>Timezone</th>
            <th>Schedule enabled</th>
            <th>Max attempts</th>
            <th>Retry interval</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in result.data.value" :key="item.schedule.id">
            <td>
              <RouterLink class="table-link" :to="`/accounts/${item.schedule.accountId}`">{{
                item.accountName
              }}</RouterLink>
            </td>
            <td>{{ item.schedule.startTime }}–{{ item.schedule.endTime }}</td>
            <td>{{ item.schedule.timezone }}</td>
            <td><StatusBadge :status="item.schedule.enabled ? 'ENABLED' : 'DISABLED'" /></td>
            <td>{{ item.schedule.maxAttempts }}</td>
            <td>{{ item.schedule.retryIntervalSeconds }} sec</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue';

import { invalidatesWorkspaceRuns } from '../api/accountWorkspaceInvalidation';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import EmptyState from '../components/EmptyState.vue';
import InlineError from '../components/InlineError.vue';
import RunStatusBadge from '../components/RunStatusBadge.vue';
import SectionLoading from '../components/SectionLoading.vue';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { formatDuration, formatTimestamp } from '../utils/format';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const runs = useRequest((signal) =>
  app.api.listRuns({ accountId: workspace.accountId.value, limit: 50 }, signal),
);

watch(app.refreshVersion, () => void runs.load());
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesWorkspaceRuns(event, workspace.accountId.value),
  () => void runs.load(),
);
</script>

<template>
  <div class="page-stack account-tab-page">
    <header class="account-tab-heading">
      <div>
        <p class="eyebrow">History</p>
        <h3>{{ workspace.account.data.value?.name ?? 'Account' }} run history</h3>
        <p>Bounded, read-only DailyRun history for this account.</p>
      </div>
      <button class="button button--secondary" type="button" @click="runs.load">Refresh</button>
    </header>

    <SectionLoading
      v-if="runs.loading.value && runs.data.value === null"
      label="Loading account history…"
    />
    <section v-else-if="runs.error.value" class="section-error-stack">
      <InlineError :message="runs.error.value.message" />
      <button class="button button--secondary" type="button" @click="runs.load">Retry</button>
    </section>
    <EmptyState
      v-else-if="runs.data.value?.length === 0"
      title="No runs yet"
      description="Runs will appear after SparkKeeper executes this account."
    />
    <div v-else-if="runs.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>BusinessDate</th>
            <th>Status</th>
            <th>Started</th>
            <th>Finished</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runs.data.value" :key="run.id">
            <td>
              <RouterLink class="table-link" :to="`/runs/${run.id}`">
                {{ run.businessDate }}
              </RouterLink>
            </td>
            <td><RunStatusBadge :status="run.status" /></td>
            <td>{{ formatTimestamp(run.startedAt) }}</td>
            <td>{{ formatTimestamp(run.finishedAt) }}</td>
            <td>{{ formatDuration(run.startedAt, run.finishedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

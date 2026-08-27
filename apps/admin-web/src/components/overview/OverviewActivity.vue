<script setup lang="ts">
import { statusLabel } from '../../statusLabels';
import type { Account, DailyRun } from '../../types/api';
import { formatTimestamp } from '../../utils/format';
import EmptyState from '../EmptyState.vue';
import InlineError from '../InlineError.vue';
import RunStatusBadge from '../RunStatusBadge.vue';
import SectionLoading from '../SectionLoading.vue';

const props = defineProps<{
  runs: readonly DailyRun[] | null;
  accounts: readonly Account[];
  loading: boolean;
  errorMessage: string | null;
}>();

defineEmits<{ retry: [] }>();

function accountName(accountId: string): string {
  return props.accounts.find((account) => account.id === accountId)?.name ?? 'Unknown account';
}

function resultSummary(run: DailyRun): string {
  return run.status === 'RUNNING' ? 'Live' : statusLabel(run.status);
}
</script>

<template>
  <section class="overview-section" aria-labelledby="activity-title" :aria-busy="loading">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">Today's activity</p>
        <h3 id="activity-title">Daily runs</h3>
      </div>
      <RouterLink class="overview-section__link" to="/runs">View all runs →</RouterLink>
    </header>
    <SectionLoading v-if="loading && runs === null" label="Loading today's activity…" />
    <div v-else-if="errorMessage" class="overview-inline-retry">
      <InlineError :message="errorMessage" />
      <button
        class="button button--secondary button--compact"
        type="button"
        @click="$emit('retry')"
      >
        Retry
      </button>
    </div>
    <EmptyState
      v-else-if="runs?.length === 0"
      title="No runs yet today"
      description="Results will appear here after a task runs."
    />
    <div v-else-if="runs" class="activity-table-wrap">
      <table class="activity-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Status</th>
            <th>Business date</th>
            <th>Timing</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runs" :key="run.id">
            <td>
              <RouterLink class="table-link" :to="`/runs/${run.id}`">
                {{ accountName(run.accountId) }}
              </RouterLink>
            </td>
            <td><RunStatusBadge :status="run.status" /></td>
            <td>{{ run.businessDate }}</td>
            <td>
              <span>{{ formatTimestamp(run.startedAt) }}</span>
              <small v-if="run.finishedAt">Finished {{ formatTimestamp(run.finishedAt) }}</small>
            </td>
            <td>
              <span :class="{ 'activity-live': run.status === 'RUNNING' }">{{
                resultSummary(run)
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

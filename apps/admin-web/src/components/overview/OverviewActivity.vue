<script setup lang="ts">
import { useStatusText } from '../../composables/useStatusText';
import { useTranslation } from '../../i18n';
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

const { t } = useTranslation();
const statusText = useStatusText();

function accountName(accountId: string): string {
  return (
    props.accounts.find((account) => account.id === accountId)?.name ?? t('common.unknownAccount')
  );
}

function resultSummary(run: DailyRun): string {
  return run.status === 'RUNNING' ? t('realtime.live') : statusText(run.status);
}
</script>

<template>
  <section class="overview-section" aria-labelledby="activity-title" :aria-busy="loading">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">{{ t('overview.activity.eyebrow') }}</p>
        <h3 id="activity-title">{{ t('overview.activity.title') }}</h3>
      </div>
      <RouterLink class="overview-section__link" to="/runs">{{
        t('overview.activity.viewAll')
      }}</RouterLink>
    </header>
    <SectionLoading v-if="loading && runs === null" :label="t('overview.activity.loading')" />
    <div v-else-if="errorMessage" class="overview-inline-retry">
      <InlineError :message="errorMessage" />
      <button
        class="button button--secondary button--compact"
        type="button"
        @click="$emit('retry')"
      >
        {{ t('common.retry') }}
      </button>
    </div>
    <EmptyState
      v-else-if="runs?.length === 0"
      :title="t('overview.activity.emptyTitle')"
      :description="t('overview.activity.emptyDescription')"
    />
    <div v-else-if="runs" class="activity-table-wrap">
      <table class="activity-table">
        <thead>
          <tr>
            <th>{{ t('common.account') }}</th>
            <th>{{ t('common.status') }}</th>
            <th>{{ t('common.businessDate') }}</th>
            <th>{{ t('overview.activity.timing') }}</th>
            <th>{{ t('overview.activity.result') }}</th>
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
              <small v-if="run.finishedAt">{{
                t('overview.activity.finishedAt', { time: formatTimestamp(run.finishedAt) })
              }}</small>
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

<script setup lang="ts">
import { watch } from 'vue';

import { invalidatesWorkspaceRuns } from '../api/accountWorkspaceInvalidation';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import EmptyState from '../components/EmptyState.vue';
import InlineError from '../components/InlineError.vue';
import RunStatusBadge from '../components/RunStatusBadge.vue';
import SectionLoading from '../components/SectionLoading.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { formatDuration, formatTimestamp } from '../utils/format';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const { t } = useTranslation();
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
        <p class="eyebrow">{{ t('historyTab.eyebrow') }}</p>
        <h3>
          {{
            t('historyTab.title', {
              account: workspace.account.data.value?.name ?? t('common.account'),
            })
          }}
        </h3>
        <p>{{ t('historyTab.subtitle') }}</p>
      </div>
      <button class="button button--secondary" type="button" @click="runs.load">
        {{ t('common.refresh') }}
      </button>
    </header>

    <BackgroundRefreshIndicator v-if="runs.refreshing.value" />
    <StaleDataNotice
      v-if="runs.refreshError.value"
      :message="runs.refreshError.value.message"
      @retry="runs.load"
    />

    <SectionLoading
      v-if="runs.loading.value && runs.data.value === null"
      :label="t('historyTab.loading')"
    />
    <section v-else-if="runs.initialError.value" class="section-error-stack">
      <InlineError :message="runs.initialError.value.message" />
      <button class="button button--secondary" type="button" @click="runs.load">
        {{ t('common.retry') }}
      </button>
    </section>
    <EmptyState
      v-else-if="runs.data.value?.length === 0"
      :title="t('historyTab.emptyTitle')"
      :description="t('historyTab.emptyDescription')"
    />
    <div v-else-if="runs.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>BusinessDate</th>
            <th>{{ t('common.status') }}</th>
            <th>{{ t('historyTab.columnStarted') }}</th>
            <th>{{ t('historyTab.columnFinished') }}</th>
            <th>{{ t('historyTab.columnDuration') }}</th>
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

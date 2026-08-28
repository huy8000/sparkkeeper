<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAdminApp } from '../appContext';
import { invalidatesRunList } from '../api/realtimeInvalidation';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import EmptyState from '../components/EmptyState.vue';
import PageError from '../components/PageError.vue';
import RunStatusBadge from '../components/RunStatusBadge.vue';
import Skeleton from '../components/Skeleton.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useStatusText } from '../composables/useStatusText';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import type { DailyRunStatus, RunFilters } from '../types/api';
import { formatDuration, formatTimestamp } from '../utils/format';

const RUN_STATUSES: readonly DailyRunStatus[] = [
  'READY',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'AUTH_EXPIRED',
];
const LIMITS: readonly (25 | 50 | 100)[] = [25, 50, 100];

const app = useAdminApp();
const route = useRoute();
const router = useRouter();

const { t } = useTranslation();
const statusText = useStatusText();

function queryStatus(value: unknown): DailyRunStatus | '' {
  return RUN_STATUSES.includes(value as DailyRunStatus) ? (value as DailyRunStatus) : '';
}

function queryLimit(value: unknown): 25 | 50 | 100 {
  const parsed = Number(value);
  return LIMITS.includes(parsed as 25 | 50 | 100) ? (parsed as 25 | 50 | 100) : 50;
}

const filters = reactive({
  accountId: typeof route.query.accountId === 'string' ? route.query.accountId : '',
  businessDate: typeof route.query.businessDate === 'string' ? route.query.businessDate : '',
  status: queryStatus(route.query.status) as DailyRunStatus | '',
  limit: queryLimit(route.query.limit),
});

function currentFilters(): RunFilters {
  return {
    ...(filters.accountId === '' ? {} : { accountId: filters.accountId }),
    ...(filters.businessDate === '' ? {} : { businessDate: filters.businessDate }),
    ...(filters.status === '' ? {} : { status: filters.status }),
    limit: filters.limit,
  };
}

const hasActiveFilters = computed(
  () => filters.accountId !== '' || filters.businessDate !== '' || filters.status !== '',
);

// Runs are primary; account lookup is a single bounded list request used only
// for name resolution, so an accounts failure never destroys the run list.
const runs = useRequest((signal) => app.api.listRuns(currentFilters(), signal));
const accounts = useRequest((signal) => app.api.listAccounts(signal));

watch(app.refreshVersion, () => {
  void runs.load();
  void accounts.load();
});
useRealtimeRefresh(app.realtime, invalidatesRunList, () => void runs.load());

const accountById = computed(() => new Map((accounts.data.value ?? []).map((a) => [a.id, a])));

function accountName(accountId: string): string {
  return accountById.value.get(accountId)?.name ?? t('common.unknownAccount');
}

async function applyFilters(): Promise<void> {
  await router.replace({
    query: {
      ...(filters.accountId === '' ? {} : { accountId: filters.accountId }),
      ...(filters.businessDate === '' ? {} : { businessDate: filters.businessDate }),
      ...(filters.status === '' ? {} : { status: filters.status }),
      limit: String(filters.limit),
    },
  });
  await runs.load();
}

async function resetFilters(): Promise<void> {
  filters.accountId = '';
  filters.businessDate = '';
  filters.status = '';
  filters.limit = 50;
  await router.replace({ query: {} });
  await runs.load();
}
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">{{ t('runs.eyebrow') }}</p>
        <h2>{{ t('runs.title') }}</h2>
        <p>{{ t('runs.subtitle') }}</p>
      </div>
      <button class="button button--secondary" type="button" @click="runs.load">
        {{ t('common.refresh') }}
      </button>
    </header>

    <form class="filter-bar" :aria-label="t('runs.filtersAria')" @submit.prevent="applyFilters">
      <label
        >{{ t('common.businessDate') }}<input v-model="filters.businessDate" type="date"
      /></label>
      <label
        >{{ t('common.account')
        }}<select v-model="filters.accountId">
          <option value="">{{ t('runs.allAccounts') }}</option>
          <option
            v-for="account in accounts.data.value ?? []"
            :key="account.id"
            :value="account.id"
          >
            {{ account.name }}
          </option>
        </select></label
      >
      <label
        >{{ t('common.status')
        }}<select v-model="filters.status">
          <option value="">{{ t('runs.allStatuses') }}</option>
          <option v-for="status in RUN_STATUSES" :key="status" :value="status">
            {{ statusText(status) }}
          </option>
        </select></label
      >
      <label
        >{{ t('runs.limit')
        }}<select v-model.number="filters.limit">
          <option v-for="limit in LIMITS" :key="limit" :value="limit">{{ limit }}</option>
        </select></label
      >
      <div class="filter-bar__actions">
        <button class="button button--primary" type="submit">{{ t('runs.apply') }}</button>
        <button class="button button--secondary" type="button" @click="resetFilters">
          {{ t('runs.reset') }}
        </button>
      </div>
    </form>

    <BackgroundRefreshIndicator v-if="runs.refreshing.value" />
    <StaleDataNotice
      v-if="runs.refreshError.value"
      :error="runs.refreshError.value"
      @retry="runs.load"
    />

    <PageError
      v-if="runs.initialError.value"
      :title="t('runs.errorTitle')"
      :error="runs.initialError.value"
      :retry-label="t('runs.tryAgain')"
      @retry="runs.load"
    />

    <div v-else-if="runs.initialLoading.value" class="runs-skeleton" aria-busy="true">
      <Skeleton v-for="index in 5" :key="index" height="44px" :label="t('runs.skeleton')" />
    </div>

    <EmptyState
      v-else-if="runs.data.value?.length === 0 && hasActiveFilters"
      :title="t('runs.emptyFilteredTitle')"
      :description="t('runs.emptyFilteredDescription')"
    >
      <template #action>
        <button class="button button--secondary" type="button" @click="resetFilters">
          {{ t('runs.resetFilters') }}
        </button>
      </template>
    </EmptyState>

    <EmptyState
      v-else-if="runs.data.value?.length === 0"
      :title="t('runs.emptyTitle')"
      :description="t('runs.emptyDescription')"
    />

    <div v-else-if="runs.data.value" class="table-wrap">
      <table>
        <caption class="visually-hidden">
          {{
            t('runs.caption')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('common.businessDate') }}</th>
            <th scope="col">{{ t('common.account') }}</th>
            <th scope="col">{{ t('common.status') }}</th>
            <th scope="col">{{ t('runs.started') }}</th>
            <th scope="col">{{ t('runs.finished') }}</th>
            <th scope="col">{{ t('runs.duration') }}</th>
            <th scope="col">
              <span class="visually-hidden">{{ t('common.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in runs.data.value"
            :key="run.id"
            :class="run.status === 'RUNNING' ? 'run-row--live' : undefined"
          >
            <td>{{ run.businessDate }}</td>
            <td>{{ accountName(run.accountId) }}</td>
            <td>
              <RunStatusBadge :status="run.status" />
              <span v-if="run.status === 'RUNNING'" class="run-live-chip">
                <span class="run-live-chip__pulse" aria-hidden="true" />
                {{ t('runs.live') }}
              </span>
            </td>
            <td>{{ formatTimestamp(run.startedAt) }}</td>
            <td>{{ formatTimestamp(run.finishedAt) }}</td>
            <td>
              {{
                run.status === 'RUNNING'
                  ? t('runs.inProgress')
                  : formatDuration(run.startedAt, run.finishedAt)
              }}
            </td>
            <td>
              <RouterLink class="button button--secondary button--compact" :to="`/runs/${run.id}`">
                {{ t('common.view') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

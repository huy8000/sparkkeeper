<script setup lang="ts">
import { computed, watch } from 'vue';

import {
  invalidatesWorkspaceFriends,
  invalidatesWorkspaceRuns,
  invalidatesWorkspaceSchedule,
} from '../api/accountWorkspaceInvalidation';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import AuthStatusBadge from '../components/AuthStatusBadge.vue';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import InlineError from '../components/InlineError.vue';
import RunStatusBadge from '../components/RunStatusBadge.vue';
import SectionLoading from '../components/SectionLoading.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const { t } = useTranslation();
const friends = useRequest((signal) => app.api.listFriends(workspace.accountId.value, signal));
const schedules = useRequest((signal) => app.api.listSchedules(workspace.accountId.value, signal));
const runs = useRequest((signal) =>
  app.api.listRuns({ accountId: workspace.accountId.value, limit: 25 }, signal),
);

watch(app.refreshVersion, () => {
  void friends.load();
  void schedules.load();
  void runs.load();
});
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesWorkspaceFriends(event, workspace.accountId.value),
  () => void friends.load(),
);
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesWorkspaceSchedule(event, workspace.accountId.value),
  () => void schedules.load(),
);
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesWorkspaceRuns(event, workspace.accountId.value),
  () => void runs.load(),
);

const enabledFriendCount = computed(
  () => friends.data.value?.filter((friend) => friend.enabled).length ?? null,
);
const schedule = computed(() => schedules.data.value?.[0] ?? null);
const latestRun = computed(() => {
  if (runs.data.value === null || runs.data.value.length === 0) return null;
  return [...runs.data.value].sort((left, right) =>
    (right.startedAt ?? right.createdAt).localeCompare(left.startedAt ?? left.createdAt),
  )[0]!;
});
const isRefreshing = computed(
  () =>
    friends.refreshing.value ||
    schedules.refreshing.value ||
    runs.refreshing.value ||
    app.runtime.refreshing.value,
);
const hasRefreshError = computed(
  () =>
    friends.refreshError.value !== null ||
    schedules.refreshError.value !== null ||
    runs.refreshError.value !== null ||
    app.runtime.refreshError.value !== null,
);
</script>

<template>
  <div class="page-stack account-tab-page">
    <header class="account-tab-heading">
      <div>
        <p class="eyebrow">{{ t('accountOverviewTab.eyebrow') }}</p>
        <h3>{{ t('accountOverviewTab.title') }}</h3>
        <p>{{ t('accountOverviewTab.subtitle') }}</p>
      </div>
    </header>

    <section
      class="account-readiness-card"
      :class="`account-readiness-card--${workspace.account.data.value?.loginStatus.toLowerCase()}`"
      aria-labelledby="account-readiness-title"
    >
      <div>
        <p class="eyebrow">{{ t('accountOverviewTab.readinessEyebrow') }}</p>
        <h3 id="account-readiness-title">
          <template v-if="workspace.account.data.value?.loginStatus === 'AUTH_EXPIRED'">
            {{ t('accountOverviewTab.readiness.authExpiredTitle') }}
          </template>
          <template v-else-if="workspace.account.data.value?.loginStatus === 'UNKNOWN'">
            {{ t('accountOverviewTab.readiness.unknownTitle') }}
          </template>
          <template v-else>{{ t('accountOverviewTab.readiness.readyTitle') }}</template>
        </h3>
        <p v-if="workspace.account.data.value?.loginStatus === 'AUTH_EXPIRED'">
          {{ t('accountOverviewTab.readiness.authExpiredDescription') }}
        </p>
        <p v-else-if="workspace.account.data.value?.loginStatus === 'UNKNOWN'">
          {{ t('accountOverviewTab.readiness.unknownDescription') }}
        </p>
        <p v-else>
          {{ t('accountOverviewTab.readiness.readyDescription') }}
        </p>
      </div>
      <div class="account-readiness-card__badges">
        <AuthStatusBadge
          v-if="workspace.account.data.value"
          :status="workspace.account.data.value.loginStatus"
        />
        <StatusBadge
          v-if="workspace.account.data.value"
          :status="workspace.account.data.value.enabled ? 'ENABLED' : 'DISABLED'"
        />
      </div>
    </section>

    <BackgroundRefreshIndicator v-if="isRefreshing" />
    <StaleDataNotice
      v-if="hasRefreshError"
      :message="t('accountOverviewTab.staleSections')"
      @retry="app.refresh"
    />

    <div class="account-summary-grid">
      <section class="account-summary-card" aria-labelledby="friends-summary-title">
        <p class="eyebrow">{{ t('accountOverviewTab.friends.eyebrow') }}</p>
        <h3 id="friends-summary-title">{{ t('accountOverviewTab.friends.title') }}</h3>
        <SectionLoading
          v-if="friends.loading.value && friends.data.value === null"
          :label="t('accountOverviewTab.friends.loading')"
        />
        <InlineError v-else-if="friends.initialError.value" :error="friends.initialError.value" />
        <template v-else>
          <strong class="account-summary-card__value">{{ enabledFriendCount ?? 0 }}</strong>
          <span>{{
            t('accountOverviewTab.friends.summary', {
              enabled: enabledFriendCount ?? 0,
              total: friends.data.value?.length ?? 0,
            })
          }}</span>
          <RouterLink :to="`/accounts/${workspace.accountId.value}/friends`">{{
            t('accountOverviewTab.friends.manage')
          }}</RouterLink>
        </template>
      </section>

      <section class="account-summary-card" aria-labelledby="schedule-summary-title">
        <p class="eyebrow">{{ t('accountOverviewTab.schedule.eyebrow') }}</p>
        <h3 id="schedule-summary-title">{{ t('accountOverviewTab.schedule.title') }}</h3>
        <SectionLoading
          v-if="schedules.loading.value && schedules.data.value === null"
          :label="t('accountOverviewTab.schedule.loading')"
        />
        <InlineError
          v-else-if="schedules.initialError.value"
          :error="schedules.initialError.value"
        />
        <template v-else-if="schedule">
          <StatusBadge :status="schedule.enabled ? 'ENABLED' : 'DISABLED'" />
          <strong>{{ schedule.startTime }}–{{ schedule.endTime }}</strong>
          <span>{{ schedule.timezone }}</span>
          <RouterLink :to="`/accounts/${workspace.accountId.value}/schedule`">{{
            t('accountOverviewTab.schedule.view')
          }}</RouterLink>
        </template>
        <template v-else>
          <strong>{{ t('accountOverviewTab.schedule.notConfigured') }}</strong>
          <span>{{ t('accountOverviewTab.schedule.notConfiguredHint') }}</span>
          <RouterLink :to="`/accounts/${workspace.accountId.value}/schedule`">{{
            t('accountOverviewTab.schedule.configure')
          }}</RouterLink>
        </template>
      </section>

      <section class="account-summary-card" aria-labelledby="latest-run-title">
        <p class="eyebrow">{{ t('accountOverviewTab.latestRun.eyebrow') }}</p>
        <h3 id="latest-run-title">{{ t('accountOverviewTab.latestRun.title') }}</h3>
        <SectionLoading
          v-if="runs.loading.value && runs.data.value === null"
          :label="t('accountOverviewTab.latestRun.loading')"
        />
        <InlineError v-else-if="runs.initialError.value" :error="runs.initialError.value" />
        <template v-else-if="latestRun">
          <RunStatusBadge :status="latestRun.status" />
          <strong>{{ latestRun.businessDate }}</strong>
          <span>{{ formatTimestamp(latestRun.startedAt ?? latestRun.createdAt) }}</span>
          <RouterLink :to="`/runs/${latestRun.id}`">{{
            t('accountOverviewTab.latestRun.view')
          }}</RouterLink>
        </template>
        <template v-else>
          <strong>{{ t('accountOverviewTab.latestRun.empty') }}</strong>
          <span>{{ t('accountOverviewTab.latestRun.emptyHint') }}</span>
          <RouterLink :to="`/accounts/${workspace.accountId.value}/history`">{{
            t('accountOverviewTab.latestRun.viewHistory')
          }}</RouterLink>
        </template>
      </section>

      <section class="account-summary-card" aria-labelledby="browser-summary-title">
        <p class="eyebrow">{{ t('accountOverviewTab.browser.eyebrow') }}</p>
        <h3 id="browser-summary-title">{{ t('accountOverviewTab.browser.title') }}</h3>
        <SectionLoading
          v-if="app.runtime.loading.value && app.runtime.data.value === null"
          :label="t('accountOverviewTab.browser.loading')"
        />
        <InlineError
          v-else-if="app.runtime.initialError.value"
          :error="app.runtime.initialError.value"
        />
        <template v-else-if="app.runtime.data.value">
          <StatusBadge
            :status="app.runtime.data.value.browserProfileConfigured ? 'READY' : 'NOT_READY'"
            :label="
              app.runtime.data.value.browserProfileConfigured
                ? t('accountOverviewTab.browser.profileConfigured')
                : t('accountOverviewTab.browser.profileNotConfigured')
            "
          />
          <AuthStatusBadge
            v-if="workspace.account.data.value"
            :status="workspace.account.data.value.loginStatus"
          />
          <span>{{ t('accountOverviewTab.browser.privacyNote') }}</span>
        </template>
      </section>
    </div>
  </div>
</template>

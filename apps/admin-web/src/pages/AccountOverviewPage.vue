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
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const workspace = useAccountWorkspace();
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
        <p class="eyebrow">Overview</p>
        <h3>Account readiness</h3>
        <p>Confirm this account is configured and understand its latest activity.</p>
      </div>
    </header>

    <section
      class="account-readiness-card"
      :class="`account-readiness-card--${workspace.account.data.value?.loginStatus.toLowerCase()}`"
      aria-labelledby="account-readiness-title"
    >
      <div>
        <p class="eyebrow">Current state</p>
        <h3 id="account-readiness-title">
          <template v-if="workspace.account.data.value?.loginStatus === 'AUTH_EXPIRED'">
            Login expired
          </template>
          <template v-else-if="workspace.account.data.value?.loginStatus === 'UNKNOWN'">
            Login status needs attention
          </template>
          <template v-else>Ready for configured automation</template>
        </h3>
        <p v-if="workspace.account.data.value?.loginStatus === 'AUTH_EXPIRED'">
          SparkKeeper has stopped the safe sending flow for this account. Login maintenance must be
          completed outside this page.
        </p>
        <p v-else-if="workspace.account.data.value?.loginStatus === 'UNKNOWN'">
          SparkKeeper cannot currently confirm the persistent browser session. Unknown is not
          treated as ready.
        </p>
        <p v-else>
          Login state is ready. Automation still follows the account, friend, schedule, and server
          gates shown below.
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
      message="Unable to refresh one or more account sections. Showing the last successful snapshots."
      @retry="app.refresh"
    />

    <div class="account-summary-grid">
      <section class="account-summary-card" aria-labelledby="friends-summary-title">
        <p class="eyebrow">Configuration</p>
        <h3 id="friends-summary-title">Friends</h3>
        <SectionLoading
          v-if="friends.loading.value && friends.data.value === null"
          label="Loading friends summary…"
        />
        <InlineError
          v-else-if="friends.initialError.value"
          :message="friends.initialError.value.message"
        />
        <template v-else>
          <strong class="account-summary-card__value">{{ enabledFriendCount ?? 0 }}</strong>
          <span>enabled of {{ friends.data.value?.length ?? 0 }} configured</span>
          <RouterLink :to="`/accounts/${workspace.accountId.value}/friends`"
            >Manage friends →</RouterLink
          >
        </template>
      </section>

      <section class="account-summary-card" aria-labelledby="schedule-summary-title">
        <p class="eyebrow">Configuration</p>
        <h3 id="schedule-summary-title">Schedule</h3>
        <SectionLoading
          v-if="schedules.loading.value && schedules.data.value === null"
          label="Loading schedule summary…"
        />
        <InlineError
          v-else-if="schedules.initialError.value"
          :message="schedules.initialError.value.message"
        />
        <template v-else-if="schedule">
          <StatusBadge :status="schedule.enabled ? 'ENABLED' : 'DISABLED'" />
          <strong>{{ schedule.startTime }}–{{ schedule.endTime }}</strong>
          <span>{{ schedule.timezone }}</span>
          <RouterLink :to="`/accounts/${workspace.accountId.value}/schedule`"
            >View schedule →</RouterLink
          >
        </template>
        <template v-else>
          <strong>Not configured</strong>
          <span>A schedule is required before server preflight can allow a Manual Run.</span>
          <RouterLink :to="`/accounts/${workspace.accountId.value}/schedule`"
            >Configure schedule →</RouterLink
          >
        </template>
      </section>

      <section class="account-summary-card" aria-labelledby="latest-run-title">
        <p class="eyebrow">Today & history</p>
        <h3 id="latest-run-title">Latest run</h3>
        <SectionLoading
          v-if="runs.loading.value && runs.data.value === null"
          label="Loading latest run…"
        />
        <InlineError
          v-else-if="runs.initialError.value"
          :message="runs.initialError.value.message"
        />
        <template v-else-if="latestRun">
          <RunStatusBadge :status="latestRun.status" />
          <strong>{{ latestRun.businessDate }}</strong>
          <span>{{ formatTimestamp(latestRun.startedAt ?? latestRun.createdAt) }}</span>
          <RouterLink :to="`/runs/${latestRun.id}`">View run →</RouterLink>
        </template>
        <template v-else>
          <strong>No runs yet</strong>
          <span>Runs will appear after SparkKeeper executes this account.</span>
          <RouterLink :to="`/accounts/${workspace.accountId.value}/history`"
            >View history →</RouterLink
          >
        </template>
      </section>

      <section class="account-summary-card" aria-labelledby="browser-summary-title">
        <p class="eyebrow">Persistent browser</p>
        <h3 id="browser-summary-title">Session summary</h3>
        <SectionLoading
          v-if="app.runtime.loading.value && app.runtime.data.value === null"
          label="Loading browser summary…"
        />
        <InlineError
          v-else-if="app.runtime.initialError.value"
          :message="app.runtime.initialError.value.message"
        />
        <template v-else-if="app.runtime.data.value">
          <StatusBadge
            :status="app.runtime.data.value.browserProfileConfigured ? 'READY' : 'NOT_READY'"
            :label="
              app.runtime.data.value.browserProfileConfigured
                ? 'Profile configured'
                : 'Profile not configured'
            "
          />
          <AuthStatusBadge
            v-if="workspace.account.data.value"
            :status="workspace.account.data.value.loginStatus"
          />
          <span>Browser profile paths, cookies, tokens, and session files are never shown.</span>
        </template>
      </section>
    </div>
  </div>
</template>

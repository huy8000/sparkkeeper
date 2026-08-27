<script setup lang="ts">
import { computed } from 'vue';

import { useAdminApp } from '../appContext';
import OverviewActivity from '../components/overview/OverviewActivity.vue';
import OverviewAttention from '../components/overview/OverviewAttention.vue';
import OverviewQuickActions from '../components/overview/OverviewQuickActions.vue';
import OverviewRuntimeSummary from '../components/overview/OverviewRuntimeSummary.vue';
import OverviewTodaySummary from '../components/overview/OverviewTodaySummary.vue';
import { useOverview } from '../composables/useOverview';

const app = useAdminApp();
const overview = useOverview();

const todayError = computed(
  () => overview.accounts.error.value?.message ?? overview.runs.error.value?.message ?? null,
);
const todayLoading = computed(
  () =>
    (overview.accounts.loading.value && overview.accounts.data.value === null) ||
    (overview.runs.loading.value && overview.runs.data.value === null),
);
const sortedRuns = computed(() =>
  overview.runs.data.value === null
    ? null
    : [...overview.runs.data.value].sort((left, right) =>
        (right.startedAt ?? right.createdAt).localeCompare(left.startedAt ?? left.createdAt),
      ),
);
const timezone = computed(() => app.runtime.data.value?.timezone ?? null);
const dateLabel = computed(() =>
  overview.businessDate.value === null
    ? 'Business date unavailable'
    : formatBusinessDate(overview.businessDate.value),
);
const greeting = computed(() => greetingForTimeZone(new Date(), timezone.value));

function formatBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

function greetingForTimeZone(now: Date, timeZone: string | null): string {
  if (timeZone === null) return 'Welcome back.';
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}
</script>

<template>
  <div class="page-stack overview-page">
    <header class="overview-hero">
      <div>
        <p class="eyebrow">Overview</p>
        <h2>{{ greeting }}</h2>
        <p>Here’s how SparkKeeper is running today.</p>
      </div>
      <div class="overview-hero__date" aria-label="Business date and timezone">
        <strong>{{ dateLabel }}</strong>
        <span
          >{{ overview.businessDate.value ?? '—' }} · {{ timezone ?? 'Timezone unavailable' }}</span
        >
      </div>
    </header>

    <OverviewTodaySummary
      :classification="overview.classification.value"
      :loading="todayLoading"
      :error-message="todayError"
      @retry="overview.refresh"
    />

    <div class="overview-two-column">
      <OverviewAttention
        :items="overview.classification.value?.attentionItems ?? []"
        :accounts="overview.accounts.data.value ?? []"
        :warning="overview.classificationWarning.value"
        :loading="todayLoading"
        :error-message="todayError"
      />
      <OverviewRuntimeSummary
        :runtime="app.runtime.data.value"
        :loading="app.runtime.loading.value"
        :error-message="app.runtime.error.value?.message ?? null"
        @retry="app.runtime.load"
      />
    </div>

    <OverviewActivity
      :runs="sortedRuns"
      :accounts="overview.accounts.data.value ?? []"
      :loading="overview.runs.loading.value"
      :error-message="overview.runs.error.value?.message ?? null"
      @retry="overview.runs.load"
    />

    <OverviewQuickActions />
  </div>
</template>

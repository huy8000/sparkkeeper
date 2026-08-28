<script setup lang="ts">
import { computed } from 'vue';

import { useAdminApp } from '../appContext';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import OverviewActivity from '../components/overview/OverviewActivity.vue';
import OverviewAttention from '../components/overview/OverviewAttention.vue';
import OverviewQuickActions from '../components/overview/OverviewQuickActions.vue';
import OverviewRuntimeSummary from '../components/overview/OverviewRuntimeSummary.vue';
import OverviewTodaySummary from '../components/overview/OverviewTodaySummary.vue';
import { useOverview } from '../composables/useOverview';
import { currentLocale, useTranslation } from '../i18n';

const app = useAdminApp();
const overview = useOverview();
const { t } = useTranslation();

const todayError = computed(
  () =>
    (overview.accounts.data.value === null ? overview.accounts.error.value?.message : null) ??
    (overview.runs.data.value === null ? overview.runs.error.value?.message : null) ??
    null,
);
const todayLoading = computed(
  () =>
    (overview.accounts.loading.value && overview.accounts.data.value === null) ||
    (overview.runs.loading.value && overview.runs.data.value === null),
);
const isRefreshing = computed(
  () =>
    overview.accounts.refreshing.value ||
    (overview.runs.loading.value && overview.runs.data.value !== null) ||
    app.runtime.refreshing.value,
);
const hasRefreshError = computed(
  () =>
    overview.accounts.refreshError.value !== null ||
    (overview.runs.data.value !== null && overview.runs.error.value !== null) ||
    app.runtime.refreshError.value !== null,
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
    ? t('overview.hero.businessDateUnavailable')
    : formatBusinessDate(overview.businessDate.value),
);
const greeting = computed(() => greetingForTimeZone(new Date(), timezone.value));

function formatBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

function greetingForTimeZone(now: Date, timeZone: string | null): string {
  if (timeZone === null) return t('overview.hero.welcome');
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  if (hour < 12) return t('overview.hero.greetingMorning');
  if (hour < 18) return t('overview.hero.greetingAfternoon');
  return t('overview.hero.greetingEvening');
}
</script>

<template>
  <div class="page-stack overview-page">
    <header class="overview-hero">
      <div>
        <p class="eyebrow">{{ t('overview.hero.eyebrow') }}</p>
        <h2>{{ greeting }}</h2>
        <p>{{ t('overview.hero.subtitle') }}</p>
      </div>
      <div class="overview-hero__date" :aria-label="t('overview.hero.dateAria')">
        <strong>{{ dateLabel }}</strong>
        <span
          >{{ overview.businessDate.value ?? '—' }} ·
          {{ timezone ?? t('overview.hero.timezoneUnavailable') }}</span
        >
      </div>
    </header>

    <BackgroundRefreshIndicator v-if="isRefreshing" />
    <StaleDataNotice v-if="hasRefreshError" @retry="overview.refresh" />

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
        :error-message="
          app.runtime.data.value === null ? (app.runtime.error.value?.message ?? null) : null
        "
        @retry="app.runtime.load"
      />
    </div>

    <OverviewActivity
      :runs="sortedRuns"
      :accounts="overview.accounts.data.value ?? []"
      :loading="overview.runs.loading.value"
      :error-message="
        overview.runs.data.value === null ? (overview.runs.error.value?.message ?? null) : null
      "
      @retry="overview.runs.load"
    />

    <OverviewQuickActions />
  </div>
</template>

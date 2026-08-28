<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import RunDeliveryList from '../components/run/RunDeliveryList.vue';
import RunResultSummary from '../components/run/RunResultSummary.vue';
import RunTechnicalDetails from '../components/run/RunTechnicalDetails.vue';
import RunTimeline from '../components/run/RunTimeline.vue';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import PageError from '../components/PageError.vue';
import RunStatusBadge from '../components/RunStatusBadge.vue';
import Skeleton from '../components/Skeleton.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useRunDetail } from '../composables/useRunDetail';
import { formatDuration, formatTimestamp } from '../utils/format';

const route = useRoute();
const runId = computed(() => String(route.params.runId));
const detail = useRunDetail(runId);

const run = computed(() => detail.run.data.value);
const is404 = computed(
  () => detail.run.data.value === null && detail.run.error.value?.httpStatus === 404,
);

const durationLabel = computed(() => {
  const current = run.value;
  if (current === null) return '—';
  if (current.status === 'RUNNING' || current.finishedAt === null) return 'In progress';
  return formatDuration(current.startedAt, current.finishedAt);
});

const successfulDeliveryCount = computed(
  () =>
    (detail.sendRecords.data.value ?? []).filter((record) => record.status === 'SUCCESS').length,
);

const failureCodes = computed(() => {
  const codes = new Set<string>();
  for (const record of detail.sendRecords.data.value ?? [])
    if (record.failureCode !== null) codes.add(record.failureCode);
  for (const event of detail.events.data.value ?? [])
    if (event.errorCode !== null) codes.add(event.errorCode);
  return [...codes];
});

const failureSummary = computed(() => {
  const errorEvents = detail.orderedEvents.value.filter((event) => event.level === 'ERROR');
  return errorEvents.length > 0 ? (errorEvents.at(-1)?.message ?? null) : null;
});
</script>

<template>
  <div class="page-stack run-detail-page">
    <p v-if="route.query.accepted === 'manual-run'" class="success-message" role="status">
      Manual Run request accepted. The final outcome appears below.
    </p>

    <!-- Primary loading: header + content skeletons, shell stays visible. -->
    <div
      v-if="detail.run.loading.value && run === null"
      class="run-detail-skeleton"
      aria-busy="true"
    >
      <Skeleton height="36px" width="40%" label="Loading run header…" />
      <Skeleton height="120px" label="Loading run summary…" />
      <div class="run-detail-skeleton__split">
        <Skeleton height="220px" label="Loading delivery records…" />
        <Skeleton height="220px" label="Loading timeline…" />
      </div>
    </div>

    <BackgroundRefreshIndicator v-if="detail.run.refreshing.value" />
    <StaleDataNotice
      v-if="detail.run.refreshError.value"
      :message="detail.run.refreshError.value.message"
      @retry="detail.refresh"
    />

    <section v-else-if="is404" class="state-panel state-panel--empty" role="alert">
      <div>
        <h2 class="state-panel__title">Run not found</h2>
        <p>This run is not available.</p>
      </div>
      <RouterLink class="button button--secondary" to="/runs">Back to Runs</RouterLink>
    </section>

    <PageError
      v-else-if="detail.run.initialError.value"
      title="Unable to load run"
      :message="detail.run.initialError.value.message"
      retry-label="Try loading again"
      @retry="detail.refresh"
    />

    <template v-else-if="run !== null && detail.detailState.value !== null">
      <header class="page-heading run-detail-heading">
        <div>
          <p class="eyebrow">Run detail</p>
          <h2>{{ run.businessDate }} · {{ detail.accountName.value }}</h2>
          <p>Read-only execution record: deliveries and persisted system events.</p>
        </div>
        <div class="run-detail-heading__statuses">
          <RunStatusBadge :status="detail.detailState.value" />
          <span v-if="run.status === 'RUNNING'" class="run-live-chip">
            <span class="run-live-chip__pulse" aria-hidden="true" />
            Live
          </span>
          <button class="button button--secondary" type="button" @click="detail.refresh">
            Refresh
          </button>
        </div>
      </header>

      <p v-if="detail.liveUpdatesUnavailable.value" class="run-live-notice" role="status">
        Live updates temporarily unavailable.
      </p>

      <dl class="definition-grid run-detail-meta">
        <div>
          <dt>Business date</dt>
          <dd>{{ run.businessDate }}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>{{ detail.accountName.value }}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{{ formatTimestamp(run.startedAt) }}</dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>{{ formatTimestamp(run.finishedAt) }}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{{ durationLabel }}</dd>
        </div>
      </dl>

      <RunResultSummary
        :state="detail.detailState.value"
        :account-id="run.accountId"
        :duration-label="durationLabel"
        :successful-delivery-count="successfulDeliveryCount"
        :failure-codes="failureCodes"
        :failure-summary="failureSummary"
      />

      <div class="run-detail-split">
        <section class="section-stack" aria-labelledby="send-records-title">
          <header class="section-heading">
            <div>
              <p class="eyebrow">Delivery results</p>
              <h3 id="send-records-title">Send records</h3>
            </div>
            <span v-if="detail.sendRecords.data.value" class="count">
              {{ detail.sendRecords.data.value.length }}
            </span>
          </header>
          <RunDeliveryList
            :records="detail.sendRecords.data.value"
            :loading="detail.sendRecords.loading.value"
            :error-message="detail.sendRecords.error.value?.message ?? null"
            :friend-name="detail.friendName"
            @retry="detail.refresh"
          />
        </section>

        <section class="section-stack" aria-labelledby="events-title">
          <header class="section-heading">
            <div>
              <p class="eyebrow">Timeline</p>
              <h3 id="events-title">System events</h3>
            </div>
            <span v-if="detail.events.data.value" class="count">
              {{ detail.events.data.value.length }}
            </span>
          </header>
          <RunTimeline
            :events="detail.orderedEvents.value"
            :loading="detail.events.loading.value"
            :error-message="detail.events.error.value?.message ?? null"
            :friend-name="detail.friendName"
            @retry="detail.refresh"
          />
        </section>
      </div>

      <RunTechnicalDetails :run="run" :send-records="detail.sendRecords.data.value" />
    </template>
  </div>
</template>

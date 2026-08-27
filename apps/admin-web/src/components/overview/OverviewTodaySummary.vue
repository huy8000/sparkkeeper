<script setup lang="ts">
import { computed } from 'vue';

import type { OverviewClassification, OverviewState } from '../../overview/classifyOverviewState';
import PageError from '../PageError.vue';
import PageLoading from '../PageLoading.vue';
import RunStatusBadge from '../RunStatusBadge.vue';

const props = defineProps<{
  classification: OverviewClassification | null;
  loading: boolean;
  errorMessage: string | null;
}>();

defineEmits<{ retry: [] }>();

const copy = computed(() => stateCopy(props.classification?.state ?? 'EMPTY'));

function stateCopy(state: OverviewState): { title: string; description: string } {
  switch (state) {
    case 'SUCCESS':
      return {
        title: 'Everything is running normally',
        description: "All of today's runs completed successfully.",
      };
    case 'RUNNING':
      return {
        title: "Today's runs are in progress",
        description: 'Live updates will appear as work completes.',
      };
    case 'FAILED':
      return {
        title: "Today's runs need attention",
        description: 'One or more runs ended with a confirmed failure.',
      };
    case 'AUTH_EXPIRED':
      return {
        title: 'Login expired',
        description: 'SparkKeeper stopped the current safe send flow.',
      };
    case 'DELIVERY_UNKNOWN':
      return {
        title: 'Delivery uncertain',
        description: 'A send action could not be verified. Do not retry automatically.',
      };
    case 'EMPTY':
      return {
        title: 'No runs yet today',
        description: 'Results will appear here after a task runs.',
      };
  }
}
</script>

<template>
  <section class="overview-section" aria-labelledby="today-summary-title" :aria-busy="loading">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">Today summary</p>
        <h3 id="today-summary-title">Today at a glance</h3>
      </div>
    </header>
    <PageLoading v-if="loading && classification === null" label="Loading today's summary…" />
    <PageError
      v-else-if="errorMessage !== null || classification === null"
      title="Today's summary is unavailable"
      :message="errorMessage ?? 'Today’s data could not be loaded.'"
      @retry="$emit('retry')"
    />
    <div
      v-else
      class="overview-summary"
      :class="`overview-summary--${classification.state.toLowerCase()}`"
    >
      <div class="overview-summary__conclusion">
        <div class="overview-summary__status">
          <RunStatusBadge :status="classification.state" />
        </div>
        <h4>{{ copy.title }}</h4>
        <p>{{ copy.description }}</p>
      </div>
      <dl class="overview-metrics" aria-label="Today totals">
        <div>
          <dt>Accounts</dt>
          <dd>{{ classification.counts.accounts }}</dd>
          <small>Total configured</small>
        </div>
        <div>
          <dt>Success</dt>
          <dd>{{ classification.counts.success }}</dd>
          <small>Completed runs</small>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{{ classification.counts.failed }}</dd>
          <small>Terminal issues</small>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{{ classification.counts.pending }}</dd>
          <small>Ready or running</small>
        </div>
      </dl>
    </div>
  </section>
</template>

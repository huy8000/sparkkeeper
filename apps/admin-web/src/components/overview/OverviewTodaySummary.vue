<script setup lang="ts">
import { computed } from 'vue';

import { useTranslation } from '../../i18n';
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

const { t } = useTranslation();

const copy = computed(() => stateCopy(props.classification?.state ?? 'EMPTY'));

function stateCopy(state: OverviewState): { title: string; description: string } {
  switch (state) {
    case 'SUCCESS':
      return {
        title: t('overview.today.state.successTitle'),
        description: t('overview.today.state.successDescription'),
      };
    case 'RUNNING':
      return {
        title: t('overview.today.state.runningTitle'),
        description: t('overview.today.state.runningDescription'),
      };
    case 'FAILED':
      return {
        title: t('overview.today.state.failedTitle'),
        description: t('overview.today.state.failedDescription'),
      };
    case 'AUTH_EXPIRED':
      return {
        title: t('overview.today.state.authExpiredTitle'),
        description: t('overview.today.state.authExpiredDescription'),
      };
    case 'DELIVERY_UNKNOWN':
      return {
        title: t('overview.today.state.deliveryUnknownTitle'),
        description: t('overview.today.state.deliveryUnknownDescription'),
      };
    case 'EMPTY':
      return {
        title: t('overview.today.state.emptyTitle'),
        description: t('overview.today.state.emptyDescription'),
      };
  }
}
</script>

<template>
  <section class="overview-section" aria-labelledby="today-summary-title" :aria-busy="loading">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">{{ t('overview.today.eyebrow') }}</p>
        <h3 id="today-summary-title">{{ t('overview.today.title') }}</h3>
      </div>
    </header>
    <PageLoading v-if="loading && classification === null" :label="t('overview.today.loading')" />
    <PageError
      v-else-if="errorMessage !== null || classification === null"
      :title="t('overview.today.errorTitle')"
      :message="errorMessage ?? t('overview.today.errorMessage')"
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
      <dl class="overview-metrics" :aria-label="t('overview.today.totalsAria')">
        <div>
          <dt>{{ t('overview.today.accountsMetric') }}</dt>
          <dd>{{ classification.counts.accounts }}</dd>
          <small>{{ t('overview.today.accountsHint') }}</small>
        </div>
        <div>
          <dt>{{ t('overview.today.successMetric') }}</dt>
          <dd>{{ classification.counts.success }}</dd>
          <small>{{ t('overview.today.successHint') }}</small>
        </div>
        <div>
          <dt>{{ t('overview.today.failedMetric') }}</dt>
          <dd>{{ classification.counts.failed }}</dd>
          <small>{{ t('overview.today.failedHint') }}</small>
        </div>
        <div>
          <dt>{{ t('overview.today.pendingMetric') }}</dt>
          <dd>{{ classification.counts.pending }}</dd>
          <small>{{ t('overview.today.pendingHint') }}</small>
        </div>
      </dl>
    </div>
  </section>
</template>

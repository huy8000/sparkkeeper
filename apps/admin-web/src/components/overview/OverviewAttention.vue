<script setup lang="ts">
import type { OverviewAttentionItem } from '../../overview/classifyOverviewState';
import type { Account } from '../../types/api';
import InlineError from '../InlineError.vue';
import RunStatusBadge from '../RunStatusBadge.vue';
import SectionLoading from '../SectionLoading.vue';

const props = defineProps<{
  items: readonly OverviewAttentionItem[];
  accounts: readonly Account[];
  warning: string | null;
  loading: boolean;
  errorMessage: string | null;
}>();

function accountName(accountId: string): string {
  return props.accounts.find((account) => account.id === accountId)?.name ?? 'Unknown account';
}

function itemTitle(item: OverviewAttentionItem): string {
  if (item.kind === 'AUTH_EXPIRED') return 'Login expired';
  if (item.kind === 'DELIVERY_UNKNOWN') return 'Delivery uncertain';
  return 'Run failed';
}

function itemDescription(item: OverviewAttentionItem): string {
  if (item.kind === 'AUTH_EXPIRED') {
    return 'SparkKeeper stopped the current safe send flow.';
  }
  if (item.kind === 'DELIVERY_UNKNOWN') {
    return 'A send action could not be verified. Do not retry automatically.';
  }
  if (item.detailUnavailable) {
    return 'The run failed. Unable to determine detailed failure reason.';
  }
  return 'The run ended with a confirmed failure.';
}
</script>

<template>
  <section class="overview-section" aria-labelledby="attention-title">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">Needs attention</p>
        <h3 id="attention-title">Actionable issues</h3>
      </div>
      <span v-if="items.length > 0" class="count">{{ items.length }}</span>
    </header>
    <SectionLoading v-if="loading" label="Checking for actionable issues…" />
    <InlineError
      v-else-if="errorMessage"
      message="Unable to determine whether any items need attention."
    />
    <InlineError v-else-if="warning" :message="warning" />
    <div v-else-if="items.length === 0" class="overview-quiet-state">
      <span class="overview-quiet-state__mark" aria-hidden="true">✓</span>
      <div>
        <strong>Nothing needs your attention</strong>
        <p>SparkKeeper has no actionable issues to report.</p>
      </div>
    </div>
    <ol v-else class="attention-list">
      <li v-for="item in items" :key="`${item.kind}-${item.runId ?? item.accountId}`">
        <div class="attention-list__body">
          <div class="attention-list__title">
            <RunStatusBadge :status="item.kind" />
            <strong>{{ itemTitle(item) }}</strong>
          </div>
          <p class="attention-list__account">{{ accountName(item.accountId) }}</p>
          <p>{{ itemDescription(item) }}</p>
        </div>
        <RouterLink
          class="button button--secondary"
          :to="
            item.kind === 'AUTH_EXPIRED'
              ? `/accounts/${item.accountId}/overview`
              : `/runs/${item.runId}`
          "
        >
          {{ item.kind === 'AUTH_EXPIRED' ? 'View account' : 'View run' }}
        </RouterLink>
      </li>
    </ol>
  </section>
</template>

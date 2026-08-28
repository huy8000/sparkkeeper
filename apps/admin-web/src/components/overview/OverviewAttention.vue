<script setup lang="ts">
import { useTranslation } from '../../i18n';
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

const { t } = useTranslation();

function accountName(accountId: string): string {
  return (
    props.accounts.find((account) => account.id === accountId)?.name ?? t('common.unknownAccount')
  );
}

function itemTitle(item: OverviewAttentionItem): string {
  if (item.kind === 'AUTH_EXPIRED') return t('overview.attention.authExpiredTitle');
  if (item.kind === 'DELIVERY_UNKNOWN') return t('overview.attention.deliveryUnknownTitle');
  return t('overview.attention.failedTitle');
}

function itemDescription(item: OverviewAttentionItem): string {
  if (item.kind === 'AUTH_EXPIRED') {
    return t('overview.attention.authExpiredDescription');
  }
  if (item.kind === 'DELIVERY_UNKNOWN') {
    return t('overview.attention.deliveryUnknownDescription');
  }
  if (item.detailUnavailable) {
    return t('overview.attention.failedDetailUnavailable');
  }
  return t('overview.attention.failedDescription');
}
</script>

<template>
  <section class="overview-section" aria-labelledby="attention-title">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">{{ t('overview.attention.eyebrow') }}</p>
        <h3 id="attention-title">{{ t('overview.attention.title') }}</h3>
      </div>
      <span v-if="items.length > 0" class="count">{{ items.length }}</span>
    </header>
    <SectionLoading v-if="loading" :label="t('overview.attention.loading')" />
    <InlineError v-else-if="errorMessage" :message="t('overview.attention.errorMessage')" />
    <InlineError v-else-if="warning" :message="warning" />
    <div v-else-if="items.length === 0" class="overview-quiet-state">
      <span class="overview-quiet-state__mark" aria-hidden="true">✓</span>
      <div>
        <strong>{{ t('overview.attention.quietTitle') }}</strong>
        <p>{{ t('overview.attention.quietDescription') }}</p>
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
          {{
            item.kind === 'AUTH_EXPIRED'
              ? t('overview.attention.viewAccount')
              : t('overview.attention.viewRun')
          }}
        </RouterLink>
      </li>
    </ol>
  </section>
</template>

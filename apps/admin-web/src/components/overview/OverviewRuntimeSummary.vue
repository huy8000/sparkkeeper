<script setup lang="ts">
import { useTranslation } from '../../i18n';
import type { RuntimeStatus } from '../../types/api';
import InlineError from '../InlineError.vue';
import SectionLoading from '../SectionLoading.vue';
import StatusBadge from '../StatusBadge.vue';

defineProps<{
  runtime: RuntimeStatus | null;
  loading: boolean;
  errorMessage: string | null;
}>();

defineEmits<{ retry: [] }>();

const { t } = useTranslation();
</script>

<template>
  <section class="overview-section" aria-labelledby="runtime-summary-title" :aria-busy="loading">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">{{ t('overview.runtimeSummary.eyebrow') }}</p>
        <h3 id="runtime-summary-title">{{ t('overview.runtimeSummary.title') }}</h3>
      </div>
      <RouterLink class="overview-section__link" to="/operations/system">{{
        t('overview.runtimeSummary.viewSystem')
      }}</RouterLink>
    </header>
    <SectionLoading
      v-if="loading && runtime === null"
      :label="t('overview.runtimeSummary.loading')"
    />
    <div v-else-if="errorMessage" class="overview-inline-retry">
      <InlineError :message="errorMessage" />
      <button
        class="button button--secondary button--compact"
        type="button"
        @click="$emit('retry')"
      >
        {{ t('common.retry') }}
      </button>
    </div>
    <dl v-else-if="runtime" class="runtime-summary-grid">
      <div>
        <dt>{{ t('overview.runtimeSummary.scheduler') }}</dt>
        <dd><StatusBadge :status="runtime.schedulerEnabled ? 'ENABLED' : 'DISABLED'" /></dd>
      </div>
      <div :class="{ 'runtime-summary-grid__warning': runtime.manualRunEnabled }">
        <dt>{{ t('overview.runtimeSummary.manualRun') }}</dt>
        <dd><StatusBadge :status="runtime.manualRunEnabled ? 'ENABLED' : 'DISABLED'" /></dd>
      </div>
      <div :class="{ 'runtime-summary-grid__warning': runtime.realSendAuthorizationEnabled }">
        <dt>{{ t('overview.runtimeSummary.realSend') }}</dt>
        <dd>
          <StatusBadge :status="runtime.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'" />
        </dd>
      </div>
      <div>
        <dt>{{ t('overview.runtimeSummary.browserProfile') }}</dt>
        <dd>
          <StatusBadge
            :status="runtime.browserProfileConfigured ? 'READY' : 'NOT_READY'"
            :label="
              runtime.browserProfileConfigured
                ? t('overview.runtimeSummary.configured')
                : t('overview.runtimeSummary.notConfigured')
            "
          />
        </dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
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
</script>

<template>
  <section class="overview-section" aria-labelledby="runtime-summary-title" :aria-busy="loading">
    <header class="overview-section__heading">
      <div>
        <p class="eyebrow">Runtime summary</p>
        <h3 id="runtime-summary-title">Safety controls</h3>
      </div>
      <RouterLink class="overview-section__link" to="/operations/system">View system →</RouterLink>
    </header>
    <SectionLoading v-if="loading && runtime === null" label="Loading runtime summary…" />
    <div v-else-if="errorMessage" class="overview-inline-retry">
      <InlineError :message="errorMessage" />
      <button
        class="button button--secondary button--compact"
        type="button"
        @click="$emit('retry')"
      >
        Retry
      </button>
    </div>
    <dl v-else-if="runtime" class="runtime-summary-grid">
      <div>
        <dt>Scheduler</dt>
        <dd><StatusBadge :status="runtime.schedulerEnabled ? 'ENABLED' : 'DISABLED'" /></dd>
      </div>
      <div :class="{ 'runtime-summary-grid__warning': runtime.manualRunEnabled }">
        <dt>Manual Run</dt>
        <dd><StatusBadge :status="runtime.manualRunEnabled ? 'ENABLED' : 'DISABLED'" /></dd>
      </div>
      <div :class="{ 'runtime-summary-grid__warning': runtime.realSendAuthorizationEnabled }">
        <dt>Real send</dt>
        <dd>
          <StatusBadge :status="runtime.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'" />
        </dd>
      </div>
      <div>
        <dt>Browser profile</dt>
        <dd>
          <StatusBadge
            :status="runtime.browserProfileConfigured ? 'READY' : 'NOT_READY'"
            :label="runtime.browserProfileConfigured ? 'Configured' : 'Not configured'"
          />
        </dd>
      </div>
    </dl>
  </section>
</template>

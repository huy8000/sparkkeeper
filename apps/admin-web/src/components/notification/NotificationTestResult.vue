<script setup lang="ts">
import { computed } from 'vue';

import type { NotificationDeliveryResult } from '../../types/api';
import StatusBadge from '../StatusBadge.vue';

const props = defineProps<{
  result: NotificationDeliveryResult | null;
  uncertain: boolean;
}>();

const title = computed(() => {
  if (props.uncertain) return 'Test request result is uncertain';
  if (props.result?.status === 'SENT') return 'Test notification sent';
  if (props.result?.status === 'FAILED') return 'Test notification failed';
  if (props.result?.status === 'BLOCKED') return 'Test notification blocked';
  return '';
});

const tone = computed(() => {
  if (props.uncertain || props.result?.status === 'BLOCKED') return 'warning';
  if (props.result?.status === 'FAILED') return 'danger';
  return 'positive';
});
</script>

<template>
  <section
    v-if="props.uncertain || props.result"
    class="notification-test-result"
    :class="`notification-test-result--${tone}`"
    :role="props.result?.status === 'SENT' ? 'status' : 'alert'"
    aria-live="polite"
  >
    <header class="notification-test-result__header">
      <div>
        <p class="eyebrow">Latest test</p>
        <h3>{{ title }}</h3>
      </div>
      <StatusBadge v-if="props.result" :status="props.result.status" />
      <StatusBadge v-else status="UNKNOWN" label="Uncertain" />
    </header>

    <p v-if="props.uncertain">
      Check the receiver before sending another test. The first request may already have arrived.
    </p>
    <dl v-else-if="props.result" class="notification-test-result__meta">
      <div>
        <dt>Attempts</dt>
        <dd>{{ props.result.attempts }}</dd>
      </div>
      <div v-if="'httpStatus' in props.result && props.result.httpStatus !== undefined">
        <dt>HTTP status</dt>
        <dd>{{ props.result.httpStatus }}</dd>
      </div>
      <div v-if="'failureCode' in props.result">
        <dt>Failure code</dt>
        <dd>{{ props.result.failureCode }}</dd>
      </div>
    </dl>
  </section>
</template>

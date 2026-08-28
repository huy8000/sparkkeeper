<script setup lang="ts">
import { computed } from 'vue';

import { useTranslation } from '../../i18n';
import type { NotificationDeliveryResult } from '../../types/api';
import StatusBadge from '../StatusBadge.vue';

const props = defineProps<{
  result: NotificationDeliveryResult | null;
  uncertain: boolean;
}>();

const { t } = useTranslation();

const title = computed(() => {
  if (props.uncertain) return t('notificationTest.uncertainTitle');
  if (props.result?.status === 'SENT') return t('notificationTest.sentTitle');
  if (props.result?.status === 'FAILED') return t('notificationTest.failedTitle');
  if (props.result?.status === 'BLOCKED') return t('notificationTest.blockedTitle');
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
        <p class="eyebrow">{{ t('notificationTest.latest') }}</p>
        <h3>{{ title }}</h3>
      </div>
      <StatusBadge v-if="props.result" :status="props.result.status" />
      <StatusBadge v-else status="UNKNOWN" :label="t('notificationTest.uncertainBadge')" />
    </header>

    <p v-if="props.uncertain">
      {{ t('notificationTest.uncertainBody') }}
    </p>
    <dl v-else-if="props.result" class="notification-test-result__meta">
      <div>
        <dt>{{ t('notificationTest.attempts') }}</dt>
        <dd>{{ props.result.attempts }}</dd>
      </div>
      <div v-if="'httpStatus' in props.result && props.result.httpStatus !== undefined">
        <dt>{{ t('notificationTest.httpStatus') }}</dt>
        <dd>{{ props.result.httpStatus }}</dd>
      </div>
      <div v-if="'failureCode' in props.result">
        <dt>{{ t('notificationTest.failureCode') }}</dt>
        <dd>{{ props.result.failureCode }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useTranslation } from '../i18n';

type RuntimeIndicator = 'READY' | 'DEGRADED' | 'LOADING' | 'UNAVAILABLE';

const props = defineProps<{ status: RuntimeIndicator }>();

const { t } = useTranslation();

const indicator = computed(() => {
  switch (props.status) {
    case 'READY':
      return { label: t('runtime.ready'), className: 'runtime-status--ready' };
    case 'DEGRADED':
      return { label: t('runtime.degraded'), className: 'runtime-status--degraded' };
    case 'UNAVAILABLE':
      return { label: t('runtime.unavailable'), className: 'runtime-status--degraded' };
    default:
      return { label: t('runtime.checking'), className: 'runtime-status--checking' };
  }
});
</script>

<template>
  <span class="runtime-status" :class="indicator.className" role="status">
    <span class="runtime-status__dot" aria-hidden="true" />
    {{ indicator.label }}
  </span>
</template>

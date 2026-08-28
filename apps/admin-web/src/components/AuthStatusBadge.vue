<script setup lang="ts">
import { useStatusText } from '../composables/useStatusText';
import type { LoginStatus } from '../types/api';
import { statusTone } from '../statusLabels';

defineProps<{ status: LoginStatus | (string & {}) }>();

const statusText = useStatusText();
</script>

<template>
  <span class="status-badge" :class="`status-badge--${statusTone(status)}`">
    <span class="status-badge__dot" aria-hidden="true" />
    {{ statusText(status) }}
  </span>
</template>

<script setup lang="ts">
import type { LoginStatus } from '../types/api';
import { statusLabel, statusTone } from '../statusLabels';

defineProps<{ status: LoginStatus | (string & {}) }>();
</script>

<template>
  <span class="status-badge" :class="`status-badge--${statusTone(status)}`">
    <span class="status-badge__dot" aria-hidden="true" />
    {{ statusLabel(status) }}
  </span>
</template>

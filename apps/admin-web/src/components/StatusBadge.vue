<script setup lang="ts">
import { computed } from 'vue';

import { statusLabel, statusTone } from '../statusLabels';

const props = defineProps<{ status: string; label?: string }>();

const tone = computed(() => statusTone(props.status));
</script>

<template>
  <span class="status-badge" :class="`status-badge--${tone}`">
    <span class="status-badge__dot" aria-hidden="true" />
    {{ label ?? statusLabel(status) }}
  </span>
</template>

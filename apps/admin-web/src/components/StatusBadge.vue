<script setup lang="ts">
import { computed } from 'vue';

import { useStatusText } from '../composables/useStatusText';
import { statusTone } from '../statusLabels';

const props = defineProps<{ status: string; label?: string }>();

const tone = computed(() => statusTone(props.status));
const statusText = useStatusText();
</script>

<template>
  <span class="status-badge" :class="`status-badge--${tone}`">
    <span class="status-badge__dot" aria-hidden="true" />
    {{ label ?? statusText(status) }}
  </span>
</template>

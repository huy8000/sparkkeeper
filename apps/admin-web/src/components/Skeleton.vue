<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed } from 'vue';

import { useTranslation } from '../i18n';

const props = withDefaults(defineProps<{ width?: string; height?: string; label?: string }>(), {
  width: '100%',
  height: '14px',
  label: '',
});

const { t } = useTranslation();
const ariaLabel = computed(() => props.label || t('common.loadingContent'));
</script>

<template>
  <span class="skeleton" role="status" :aria-label="ariaLabel" :style="{ width, height }" />
</template>

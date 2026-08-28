<script setup lang="ts">
import { ref } from 'vue';

import { useTranslation } from '../i18n';

const props = defineProps<{ value: string; compact?: boolean }>();
const copied = ref(false);

const { t } = useTranslation();

async function copy(): Promise<void> {
  if (globalThis.navigator.clipboard === undefined) return;
  await globalThis.navigator.clipboard.writeText(props.value);
  copied.value = true;
  globalThis.setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <span class="identifier">
    <code :title="compact ? value : undefined">{{
      compact ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
    }}</code>
    <button
      class="copy-button"
      type="button"
      :aria-label="t('common.copyIdentifier', { value })"
      @click="copy"
    >
      {{ copied ? t('common.copied') : t('common.copy') }}
    </button>
  </span>
</template>

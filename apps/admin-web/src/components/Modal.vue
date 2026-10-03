<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
/* global HTMLElement */
import { ref, useId } from 'vue';
import { useDialogFocus } from '../composables/useDialogFocus';

import { useTranslation } from '../i18n';

const props = defineProps<{
  open: boolean;
  title: string;
  labelledBy?: string;
  compact?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useTranslation();
const dialog = ref<HTMLElement | null>(null);
const titleId = useId();
useDialogFocus(
  dialog,
  () => props.open,
  () => emit('close'),
);
</script>

<template>
  <Teleport v-if="open" to="body">
    <div class="modal-backdrop" @click.self="$emit('close')">
      <div
        ref="dialog"
        tabindex="-1"
        class="modal-card"
        :class="{ 'modal-card--compact': compact }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledBy ?? titleId"
      >
        <header class="modal-card__header">
          <h3 :id="labelledBy ?? titleId">{{ title }}</h3>
          <button
            class="modal-card__dismiss"
            type="button"
            :aria-label="t('common.closeDialog')"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
/* global HTMLElement */
import { ref, useId } from 'vue';
import { useDialogFocus } from '../composables/useDialogFocus';

import { useTranslation } from '../i18n';

const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useTranslation();
const panel = ref<HTMLElement | null>(null);
const titleId = useId();
useDialogFocus(
  panel,
  () => props.open,
  () => emit('close'),
);
</script>

<template>
  <Teleport v-if="open" to="body">
    <div class="drawer-backdrop" @click.self="$emit('close')">
      <aside
        ref="panel"
        tabindex="-1"
        :aria-labelledby="titleId"
        class="drawer"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="drawer__header">
          <h3 :id="titleId">{{ title }}</h3>
          <button
            class="modal-card__dismiss"
            type="button"
            :aria-label="t('common.closePanel')"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>
        <div class="drawer__body">
          <slot />
        </div>
      </aside>
    </div>
  </Teleport>
</template>

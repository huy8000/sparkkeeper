<script setup lang="ts">
import { useTranslation } from '../i18n';
import Modal from './Modal.vue';

const props = defineProps<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
}>();

defineEmits<{ confirm: []; close: [] }>();

const { t } = useTranslation();
</script>

<template>
  <Modal
    :open="props.open"
    :title="props.title"
    labelled-by="danger-confirmation-title"
    compact
    @close="$emit('close')"
  >
    <div class="danger-confirmation">
      <p class="danger-confirmation__description">{{ props.description }}</p>
      <slot />
      <div class="modal-actions">
        <button class="button button--secondary" type="button" @click="$emit('close')">
          {{ props.cancelLabel ?? t('common.cancel') }}
        </button>
        <button
          class="button button--danger"
          type="button"
          :disabled="props.pending"
          @click="$emit('confirm')"
        >
          {{ props.confirmLabel ?? t('common.confirm') }}
        </button>
      </div>
    </div>
  </Modal>
</template>

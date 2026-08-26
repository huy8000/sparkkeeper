<script setup lang="ts">
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
</script>

<template>
  <Modal
    :open="props.open"
    :title="props.title"
    labelled-by="danger-confirmation-title"
    @close="$emit('close')"
  >
    <div class="danger-confirmation">
      <p class="danger-confirmation__description">{{ props.description }}</p>
      <slot />
      <div class="modal-actions">
        <button class="button button--secondary" type="button" @click="$emit('close')">
          {{ props.cancelLabel ?? 'Cancel' }}
        </button>
        <button
          class="button button--danger"
          type="button"
          :disabled="props.pending"
          @click="$emit('confirm')"
        >
          {{ props.confirmLabel ?? 'Confirm' }}
        </button>
      </div>
    </div>
  </Modal>
</template>

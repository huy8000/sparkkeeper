<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import type { Account, CreateAccountInput } from '../types/api';

const props = defineProps<{
  account?: Account;
  submitting: boolean;
  serverError?: string;
}>();
const emit = defineEmits<{ submit: [value: CreateAccountInput]; cancel: [] }>();
const form = reactive({ name: '', enabled: true });
const validationError = ref('');

watch(
  () => props.account,
  (account) => {
    form.name = account?.name ?? '';
    form.enabled = account?.enabled ?? true;
    validationError.value = '';
  },
  { immediate: true },
);

function submit(): void {
  const name = form.name.trim();
  if (name.length === 0) {
    validationError.value = 'Account name is required.';
    return;
  }
  validationError.value = '';
  emit('submit', { name, enabled: form.enabled });
}
</script>

<template>
  <form class="config-form" novalidate @submit.prevent="submit">
    <label>
      Account name
      <input v-model="form.name" name="accountName" autocomplete="off" :disabled="submitting" />
    </label>
    <label class="checkbox-field">
      <input v-model="form.enabled" name="accountEnabled" type="checkbox" :disabled="submitting" />
      Account enabled
    </label>
    <p v-if="validationError || serverError" class="form-error" role="alert">
      {{ validationError || serverError }}
    </p>
    <div class="form-actions">
      <button class="button button--primary" type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : 'Save account' }}
      </button>
      <button
        class="button button--secondary"
        type="button"
        :disabled="submitting"
        @click="$emit('cancel')"
      >
        Reset
      </button>
    </div>
  </form>
</template>

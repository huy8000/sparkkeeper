<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import type { Account, CreateAccountInput } from '../types/api';
import { useTranslation } from '../i18n';
import FormField from './FormField.vue';

const { t } = useTranslation();

const props = defineProps<{
  account?: Account;
  submitting: boolean;
  serverError?: string;
}>();
const emit = defineEmits<{
  submit: [value: CreateAccountInput];
  cancel: [];
  dirtyChange: [dirty: boolean];
}>();
const form = reactive({ name: '', enabled: true });
const validationError = ref('');
const initialSnapshot = ref('');
const dirty = computed(() => JSON.stringify(form) !== initialSnapshot.value);

watch(
  () => props.account,
  (account) => {
    form.name = account?.name ?? '';
    form.enabled = account?.enabled ?? true;
    initialSnapshot.value = JSON.stringify(form);
    validationError.value = '';
  },
  { immediate: true },
);
watch(dirty, (value) => emit('dirtyChange', value), { immediate: true });

function submit(): void {
  const name = form.name.trim();
  if (name.length === 0) {
    validationError.value = t('accountForm.nameRequired');
    return;
  }
  validationError.value = '';
  emit('submit', { name, enabled: form.enabled });
}
</script>

<template>
  <form class="config-form" novalidate @submit.prevent="submit">
    <FormField :label="t('accountForm.accountName')">
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model="form.name"
          name="accountName"
          autocomplete="off"
          :aria-describedby="validationError || serverError ? 'account-form-error' : describedBy"
          :aria-invalid="Boolean(validationError || serverError)"
          :disabled="submitting"
        />
      </template>
    </FormField>
    <label class="checkbox-field">
      <input v-model="form.enabled" name="accountEnabled" type="checkbox" :disabled="submitting" />
      {{ t('accountForm.accountEnabled') }}
    </label>
    <p
      v-if="validationError || serverError"
      id="account-form-error"
      class="form-error"
      role="alert"
    >
      {{ validationError || serverError }}
    </p>
    <div class="form-actions">
      <button class="button button--primary" type="submit" :disabled="submitting">
        {{ submitting ? t('accountForm.saving') : t('accountForm.save') }}
      </button>
      <button
        class="button button--secondary"
        type="button"
        :disabled="submitting"
        @click="$emit('cancel')"
      >
        {{ t('common.cancel') }}
      </button>
    </div>
  </form>
</template>

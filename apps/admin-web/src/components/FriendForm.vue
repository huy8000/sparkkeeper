<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import type { Friend, FriendConfigurationInput, FriendMatchField } from '../types/api';
import FormField from './FormField.vue';

const props = defineProps<{
  friend?: Friend | undefined;
  submitting: boolean;
  serverError?: string;
}>();
const emit = defineEmits<{ submit: [value: FriendConfigurationInput]; cancel: [] }>();
const matchFields: readonly { value: FriendMatchField; label: string; stability: string }[] = [
  { value: 'secUid', label: 'Sec UID', stability: 'Highest stability' },
  { value: 'uniqueId', label: 'Unique ID', stability: 'High stability' },
  { value: 'shortId', label: 'Short ID', stability: 'Medium stability' },
  { value: 'remarkName', label: 'Remark name', stability: 'Lower stability' },
  { value: 'displayName', label: 'Display name', stability: 'Low stability' },
];
const form = reactive({
  displayName: '',
  remarkName: '',
  shortId: '',
  uniqueId: '',
  secUid: '',
  matchField: 'displayName' as FriendMatchField,
  enabled: true,
});
const validationError = ref('');

watch(
  () => props.friend,
  (friend) => {
    form.displayName = friend?.displayName ?? '';
    form.remarkName = friend?.remarkName ?? '';
    form.shortId = friend?.shortId ?? '';
    form.uniqueId = friend?.uniqueId ?? '';
    form.secUid = friend?.secUid ?? '';
    form.matchField = friend?.matchField ?? 'displayName';
    form.enabled = friend?.enabled ?? true;
    validationError.value = '';
  },
  { immediate: true },
);

const selectedIdentity = computed({
  get: () => form[form.matchField],
  set: (value: string) => {
    form[form.matchField] = value;
  },
});
const selectedMatch = computed(() => matchFields.find((field) => field.value === form.matchField));

function submit(): void {
  const displayName = form.displayName.trim();
  if (displayName.length === 0) {
    validationError.value = 'Display name is required.';
    return;
  }
  if (form[form.matchField].trim().length === 0) {
    validationError.value = `${selectedMatch.value?.label ?? 'Selected identity'} is required when selected as the match strategy.`;
    return;
  }
  validationError.value = '';
  emit('submit', {
    displayName,
    remarkName: optionalValue(form.remarkName),
    shortId: optionalValue(form.shortId),
    uniqueId: optionalValue(form.uniqueId),
    secUid: optionalValue(form.secUid),
    matchField: form.matchField,
    enabled: form.enabled,
  });
}

function optionalValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
</script>

<template>
  <form class="config-form" novalidate @submit.prevent="submit">
    <FormField label="Display name" help-text="A human label for this local configuration.">
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model="form.displayName"
          name="displayName"
          autocomplete="off"
          :aria-describedby="validationError || serverError ? 'friend-form-error' : describedBy"
          :aria-invalid="Boolean(validationError || serverError)"
          :disabled="submitting"
        />
      </template>
    </FormField>

    <label class="checkbox-field">
      <input v-model="form.enabled" name="friendEnabled" type="checkbox" :disabled="submitting" />
      Friend enabled
    </label>
    <small class="form-note">Only enabled friends participate in runs.</small>

    <FormField
      label="Match strategy"
      help-text="Prefer Sec UID or Unique ID when those identifiers are available."
    >
      <template #default="{ fieldId, describedBy }">
        <select
          :id="fieldId"
          v-model="form.matchField"
          name="matchField"
          :aria-describedby="validationError || serverError ? 'friend-form-error' : describedBy"
          :disabled="submitting"
        >
          <option v-for="field in matchFields" :key="field.value" :value="field.value">
            {{ field.label }} — {{ field.stability }}
          </option>
        </select>
      </template>
    </FormField>

    <FormField
      v-if="form.matchField !== 'displayName'"
      :label="selectedMatch?.label ?? 'Selected identity'"
      :help-text="`${selectedMatch?.stability ?? 'Selected strategy'} match value.`"
    >
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model="selectedIdentity"
          :name="form.matchField"
          autocomplete="off"
          :aria-describedby="validationError || serverError ? 'friend-form-error' : describedBy"
          :aria-invalid="Boolean(validationError || serverError)"
          :disabled="submitting"
        />
      </template>
    </FormField>
    <p v-else class="stability-notice stability-notice--low">
      Display Name is a low-stability match strategy and may change or be ambiguous.
    </p>

    <details class="advanced-fields">
      <summary>Advanced identity fields</summary>
      <div class="advanced-fields__grid">
        <FormField v-if="form.matchField !== 'remarkName'" label="Remark name">
          <template #default="{ fieldId, describedBy }">
            <input
              :id="fieldId"
              v-model="form.remarkName"
              name="remarkName"
              autocomplete="off"
              :aria-describedby="describedBy"
              :disabled="submitting"
            />
          </template>
        </FormField>
        <FormField v-if="form.matchField !== 'shortId'" label="Short ID">
          <template #default="{ fieldId, describedBy }">
            <input
              :id="fieldId"
              v-model="form.shortId"
              name="shortId"
              autocomplete="off"
              :aria-describedby="describedBy"
              :disabled="submitting"
            />
          </template>
        </FormField>
        <FormField v-if="form.matchField !== 'uniqueId'" label="Unique ID">
          <template #default="{ fieldId, describedBy }">
            <input
              :id="fieldId"
              v-model="form.uniqueId"
              name="uniqueId"
              autocomplete="off"
              :aria-describedby="describedBy"
              :disabled="submitting"
            />
          </template>
        </FormField>
        <FormField v-if="form.matchField !== 'secUid'" label="Sec UID">
          <template #default="{ fieldId, describedBy }">
            <input
              :id="fieldId"
              v-model="form.secUid"
              name="secUid"
              autocomplete="off"
              :aria-describedby="describedBy"
              :disabled="submitting"
            />
          </template>
        </FormField>
      </div>
    </details>

    <p v-if="validationError || serverError" id="friend-form-error" class="form-error" role="alert">
      {{ validationError || serverError }}
    </p>
    <div class="form-actions">
      <button class="button button--primary" type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : 'Save friend' }}
      </button>
      <button
        class="button button--secondary"
        type="button"
        :disabled="submitting"
        @click="$emit('cancel')"
      >
        Cancel
      </button>
    </div>
  </form>
</template>

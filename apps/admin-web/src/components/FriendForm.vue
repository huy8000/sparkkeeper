<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import type { Friend, FriendConfigurationInput, FriendMatchField } from '../types/api';

const props = defineProps<{
  friend: Friend | undefined;
  submitting: boolean;
  serverError?: string;
}>();
const emit = defineEmits<{ submit: [value: FriendConfigurationInput]; cancel: [] }>();
const matchFields: readonly FriendMatchField[] = [
  'displayName',
  'remarkName',
  'shortId',
  'uniqueId',
  'secUid',
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

function submit(): void {
  const displayName = form.displayName.trim();
  if (displayName.length === 0) {
    validationError.value = 'Display name is required.';
    return;
  }
  const selected = form[form.matchField].trim();
  if (selected.length === 0) {
    validationError.value = `A value is required for the selected ${form.matchField} match field.`;
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
  <form class="config-form config-form--grid" novalidate @submit.prevent="submit">
    <label>
      Display name
      <input
        v-model="form.displayName"
        name="displayName"
        autocomplete="off"
        :disabled="submitting"
      />
    </label>
    <label>
      Remark name
      <input
        v-model="form.remarkName"
        name="remarkName"
        autocomplete="off"
        :disabled="submitting"
      />
    </label>
    <label>
      Short ID
      <input v-model="form.shortId" name="shortId" autocomplete="off" :disabled="submitting" />
    </label>
    <label>
      Unique ID
      <input v-model="form.uniqueId" name="uniqueId" autocomplete="off" :disabled="submitting" />
    </label>
    <label>
      secUid
      <input v-model="form.secUid" name="secUid" autocomplete="off" :disabled="submitting" />
    </label>
    <label>
      Match field
      <select v-model="form.matchField" name="matchField" :disabled="submitting">
        <option v-for="field in matchFields" :key="field" :value="field">{{ field }}</option>
      </select>
      <small>Provide a value for {{ form.matchField }}; stable identifiers remain preferred.</small>
    </label>
    <label class="checkbox-field">
      <input v-model="form.enabled" name="friendEnabled" type="checkbox" :disabled="submitting" />
      Friend enabled
    </label>
    <p v-if="form.enabled && props.friend?.enabled === false" class="form-note">
      Enabling this contact makes it eligible for future configured schedules; this form does not
      run or send anything.
    </p>
    <p v-if="validationError || serverError" class="form-error" role="alert">
      {{ validationError || serverError }}
    </p>
    <div class="form-actions form-actions--full">
      <button class="button button--primary" type="submit" :disabled="submitting">
        {{ submitting ? 'Saving…' : 'Save friend' }}
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

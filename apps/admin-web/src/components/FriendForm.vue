<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import type { Friend, FriendConfigurationInput, FriendMatchField } from '../types/api';
import { useTranslation } from '../i18n';
import FormField from './FormField.vue';

const { t } = useTranslation();

const props = defineProps<{
  friend?: Friend | undefined;
  submitting: boolean;
  serverError?: string;
}>();
const emit = defineEmits<{ submit: [value: FriendConfigurationInput]; cancel: [] }>();
const matchFields: readonly { value: FriendMatchField; labelKey: string; stabilityKey: string }[] =
  [
    {
      value: 'secUid',
      labelKey: 'friendMatchField.secUid',
      stabilityKey: 'friendStability.highest',
    },
    {
      value: 'uniqueId',
      labelKey: 'friendMatchField.uniqueId',
      stabilityKey: 'friendStability.high',
    },
    {
      value: 'shortId',
      labelKey: 'friendMatchField.shortId',
      stabilityKey: 'friendStability.medium',
    },
    {
      value: 'remarkName',
      labelKey: 'friendMatchField.remarkName',
      stabilityKey: 'friendStability.lower',
    },
    {
      value: 'displayName',
      labelKey: 'friendMatchField.displayName',
      stabilityKey: 'friendStability.low',
    },
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
    validationError.value = t('friendForm.displayNameRequired');
    return;
  }
  if (form[form.matchField].trim().length === 0) {
    validationError.value = t('friendForm.identityRequired', {
      label: selectedMatch.value
        ? t(selectedMatch.value.labelKey)
        : t('friendForm.selectedIdentity'),
    });
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
    <FormField
      :label="t('friendForm.displayNameLabel')"
      :help-text="t('friendForm.displayNameHelp')"
    >
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
      {{ t('friendForm.friendEnabled') }}
    </label>
    <small class="form-note">{{ t('friendForm.enabledNote') }}</small>

    <FormField
      :label="t('friendForm.matchStrategyLabel')"
      :help-text="t('friendForm.matchStrategyHelp')"
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
            {{ t(field.labelKey) }} — {{ t(field.stabilityKey) }}
          </option>
        </select>
      </template>
    </FormField>

    <FormField
      v-if="form.matchField !== 'displayName'"
      :label="selectedMatch ? t(selectedMatch.labelKey) : t('friendForm.selectedIdentity')"
      :help-text="
        t('friendForm.identityHelp', {
          stability: selectedMatch
            ? t(selectedMatch.stabilityKey)
            : t('friendForm.selectedStrategy'),
        })
      "
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
      {{ t('friendForm.displayNameNotice') }}
    </p>

    <details class="advanced-fields">
      <summary>{{ t('friendForm.advancedFields') }}</summary>
      <div class="advanced-fields__grid">
        <FormField
          v-if="form.matchField !== 'remarkName'"
          :label="t('friendMatchField.remarkName')"
        >
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
        <FormField v-if="form.matchField !== 'shortId'" :label="t('friendMatchField.shortId')">
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
        <FormField v-if="form.matchField !== 'uniqueId'" :label="t('friendMatchField.uniqueId')">
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
        <FormField v-if="form.matchField !== 'secUid'" :label="t('friendMatchField.secUid')">
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
        {{ submitting ? t('friendForm.saving') : t('friendForm.save') }}
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

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import {
  MAX_MAX_ATTEMPTS,
  MAX_RETRY_INTERVAL_SECONDS,
  MIN_MAX_ATTEMPTS,
  MIN_RETRY_INTERVAL_SECONDS,
} from '@sparkkeeper/shared';

import type { ConfigureScheduleInput, Schedule } from '../types/api';
import { useTranslation } from '../i18n';
import FormField from './FormField.vue';

const { t } = useTranslation();

const props = withDefaults(
  defineProps<{
    schedule?: Schedule | undefined;
    defaultTimezone?: string;
    submitting: boolean;
    serverError?: string;
  }>(),
  { schedule: undefined, defaultTimezone: 'UTC', serverError: '' },
);
const emit = defineEmits<{
  submit: [value: ConfigureScheduleInput];
  cancel: [];
  dirtyChange: [dirty: boolean];
}>();
const form = reactive<ConfigureScheduleInput>({
  startTime: '09:00',
  endTime: '10:00',
  timezone: 'UTC',
  enabled: true,
  maxAttempts: 3,
  retryIntervalSeconds: 60,
});
const validationError = ref('');
const initialSnapshot = ref('');
const dirty = computed(() => JSON.stringify(form) !== initialSnapshot.value);

watch(
  [() => props.schedule, () => props.defaultTimezone],
  ([schedule, defaultTimezone]) => {
    Object.assign(form, {
      startTime: schedule?.startTime ?? '09:00',
      endTime: schedule?.endTime ?? '10:00',
      timezone: schedule?.timezone ?? defaultTimezone,
      enabled: schedule?.enabled ?? true,
      maxAttempts: schedule?.maxAttempts ?? 3,
      retryIntervalSeconds: schedule?.retryIntervalSeconds ?? 60,
    });
    initialSnapshot.value = JSON.stringify(form);
    validationError.value = '';
  },
  { immediate: true },
);
watch(dirty, (value) => emit('dirtyChange', value), { immediate: true });

function submit(): void {
  if (form.startTime >= form.endTime) {
    validationError.value = t('scheduleForm.startBeforeEnd');
    return;
  }
  if (form.timezone.trim().length === 0) {
    validationError.value = t('scheduleForm.timezoneRequired');
    return;
  }
  if (
    !Number.isInteger(form.maxAttempts) ||
    form.maxAttempts < MIN_MAX_ATTEMPTS ||
    form.maxAttempts > MAX_MAX_ATTEMPTS
  ) {
    validationError.value = t('scheduleForm.maxAttemptsRange', {
      min: MIN_MAX_ATTEMPTS,
      max: MAX_MAX_ATTEMPTS,
    });
    return;
  }
  if (
    !Number.isInteger(form.retryIntervalSeconds) ||
    form.retryIntervalSeconds < MIN_RETRY_INTERVAL_SECONDS ||
    form.retryIntervalSeconds > MAX_RETRY_INTERVAL_SECONDS
  ) {
    validationError.value = t('scheduleForm.retryIntervalRange', {
      min: MIN_RETRY_INTERVAL_SECONDS,
      max: MAX_RETRY_INTERVAL_SECONDS,
    });
    return;
  }
  validationError.value = '';
  emit('submit', { ...form, timezone: form.timezone.trim() });
}
</script>

<template>
  <form class="config-form config-form--grid" novalidate @submit.prevent="submit">
    <FormField :label="t('scheduleForm.startLabel')" :help-text="t('scheduleForm.startHelp')">
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model="form.startTime"
          name="startTime"
          type="time"
          :aria-describedby="validationError || serverError ? 'schedule-form-error' : describedBy"
          :aria-invalid="Boolean(validationError || serverError)"
          :disabled="submitting"
        />
      </template>
    </FormField>
    <FormField :label="t('scheduleForm.endLabel')" :help-text="t('scheduleForm.endHelp')">
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model="form.endTime"
          name="endTime"
          type="time"
          :aria-describedby="validationError || serverError ? 'schedule-form-error' : describedBy"
          :aria-invalid="Boolean(validationError || serverError)"
          :disabled="submitting"
        />
      </template>
    </FormField>
    <FormField :label="t('scheduleForm.timezoneLabel')" :help-text="t('scheduleForm.timezoneHelp')">
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model="form.timezone"
          name="timezone"
          autocomplete="off"
          :aria-describedby="validationError || serverError ? 'schedule-form-error' : describedBy"
          :aria-invalid="Boolean(validationError || serverError)"
          :disabled="submitting"
        />
      </template>
    </FormField>
    <FormField
      :label="t('scheduleForm.maxAttemptsLabel')"
      :help-text="`${MIN_MAX_ATTEMPTS}–${MAX_MAX_ATTEMPTS}`"
    >
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model.number="form.maxAttempts"
          name="maxAttempts"
          type="number"
          :min="MIN_MAX_ATTEMPTS"
          :max="MAX_MAX_ATTEMPTS"
          :aria-describedby="validationError || serverError ? 'schedule-form-error' : describedBy"
          :aria-invalid="Boolean(validationError || serverError)"
          :disabled="submitting"
        />
      </template>
    </FormField>
    <FormField
      :label="t('scheduleForm.retryIntervalLabel')"
      :help-text="`${MIN_RETRY_INTERVAL_SECONDS}–${MAX_RETRY_INTERVAL_SECONDS}`"
    >
      <template #default="{ fieldId, describedBy }">
        <input
          :id="fieldId"
          v-model.number="form.retryIntervalSeconds"
          name="retryIntervalSeconds"
          type="number"
          :min="MIN_RETRY_INTERVAL_SECONDS"
          :max="MAX_RETRY_INTERVAL_SECONDS"
          :aria-describedby="validationError || serverError ? 'schedule-form-error' : describedBy"
          :aria-invalid="Boolean(validationError || serverError)"
          :disabled="submitting"
        />
      </template>
    </FormField>
    <label class="checkbox-field">
      <input v-model="form.enabled" name="scheduleEnabled" type="checkbox" :disabled="submitting" />
      {{ t('scheduleForm.scheduleEnabled') }}
    </label>
    <p class="form-note form-actions--full">
      {{ t('scheduleForm.windowNote') }}
    </p>
    <p class="form-note form-actions--full">
      {{ t('scheduleForm.saveNote') }}
    </p>
    <p
      v-if="validationError || serverError"
      id="schedule-form-error"
      class="form-error form-actions--full"
      role="alert"
    >
      {{ validationError || serverError }}
    </p>
    <div class="form-actions form-actions--full">
      <button class="button button--primary" type="submit" :disabled="submitting">
        {{ submitting ? t('scheduleForm.saving') : t('scheduleForm.save') }}
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

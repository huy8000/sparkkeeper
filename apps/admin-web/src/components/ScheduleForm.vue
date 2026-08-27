<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import {
  MAX_MAX_ATTEMPTS,
  MAX_RETRY_INTERVAL_SECONDS,
  MIN_MAX_ATTEMPTS,
  MIN_RETRY_INTERVAL_SECONDS,
} from '@sparkkeeper/shared';

import type { ConfigureScheduleInput, Schedule } from '../types/api';
import FormField from './FormField.vue';

const props = withDefaults(
  defineProps<{
    schedule?: Schedule | undefined;
    defaultTimezone?: string;
    submitting: boolean;
    serverError?: string;
  }>(),
  { schedule: undefined, defaultTimezone: 'UTC', serverError: '' },
);
const emit = defineEmits<{ submit: [value: ConfigureScheduleInput]; cancel: [] }>();
const form = reactive<ConfigureScheduleInput>({
  startTime: '09:00',
  endTime: '10:00',
  timezone: 'UTC',
  enabled: true,
  maxAttempts: 3,
  retryIntervalSeconds: 60,
});
const validationError = ref('');

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
    validationError.value = '';
  },
  { immediate: true },
);

function submit(): void {
  if (form.startTime >= form.endTime) {
    validationError.value = 'Start time must be before end time.';
    return;
  }
  if (form.timezone.trim().length === 0) {
    validationError.value = 'Timezone is required.';
    return;
  }
  if (
    !Number.isInteger(form.maxAttempts) ||
    form.maxAttempts < MIN_MAX_ATTEMPTS ||
    form.maxAttempts > MAX_MAX_ATTEMPTS
  ) {
    validationError.value = `Maximum attempts must be from ${MIN_MAX_ATTEMPTS} through ${MAX_MAX_ATTEMPTS}.`;
    return;
  }
  if (
    !Number.isInteger(form.retryIntervalSeconds) ||
    form.retryIntervalSeconds < MIN_RETRY_INTERVAL_SECONDS ||
    form.retryIntervalSeconds > MAX_RETRY_INTERVAL_SECONDS
  ) {
    validationError.value = `Retry interval must be from ${MIN_RETRY_INTERVAL_SECONDS} through ${MAX_RETRY_INTERVAL_SECONDS} seconds.`;
    return;
  }
  validationError.value = '';
  emit('submit', { ...form, timezone: form.timezone.trim() });
}
</script>

<template>
  <form class="config-form config-form--grid" novalidate @submit.prevent="submit">
    <FormField label="Start" help-text="Start of the automatic execution window.">
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
    <FormField label="End" help-text="End of the automatic execution window.">
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
    <FormField label="Timezone" help-text="BusinessDate and schedule window timezone.">
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
    <FormField label="Maximum attempts" :help-text="`${MIN_MAX_ATTEMPTS}–${MAX_MAX_ATTEMPTS}`">
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
      label="Retry interval seconds"
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
      Schedule enabled
    </label>
    <p class="form-note form-actions--full">
      This window constrains the automatic Scheduler. Manual Run remains governed by server
      preflight for the current BusinessDate and is not restricted to being in this window.
    </p>
    <p class="form-note form-actions--full">
      Saving does not change the runtime Scheduler or Real Send Authorization and does not start a
      run.
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
        {{ submitting ? 'Saving…' : 'Save schedule' }}
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

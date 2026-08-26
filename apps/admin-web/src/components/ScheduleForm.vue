<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import {
  MAX_MAX_ATTEMPTS,
  MAX_RETRY_INTERVAL_SECONDS,
  MIN_MAX_ATTEMPTS,
  MIN_RETRY_INTERVAL_SECONDS,
} from '@sparkkeeper/shared';

import type { ConfigureScheduleInput, Schedule } from '../types/api';

const props = defineProps<{ schedule: Schedule; submitting: boolean; serverError?: string }>();
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
  () => props.schedule,
  (schedule) =>
    Object.assign(form, {
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      maxAttempts: schedule.maxAttempts,
      retryIntervalSeconds: schedule.retryIntervalSeconds,
    }),
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
    validationError.value = `Max attempts must be from ${MIN_MAX_ATTEMPTS} through ${MAX_MAX_ATTEMPTS}.`;
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
    <label
      >Start time<input
        v-model="form.startTime"
        name="startTime"
        type="time"
        :disabled="submitting"
    /></label>
    <label
      >End time<input v-model="form.endTime" name="endTime" type="time" :disabled="submitting"
    /></label>
    <label
      >Timezone<input
        v-model="form.timezone"
        name="timezone"
        autocomplete="off"
        :disabled="submitting"
    /></label>
    <label
      >Max attempts<input
        v-model.number="form.maxAttempts"
        name="maxAttempts"
        type="number"
        :min="MIN_MAX_ATTEMPTS"
        :max="MAX_MAX_ATTEMPTS"
        :disabled="submitting"
    /></label>
    <label
      >Retry interval seconds<input
        v-model.number="form.retryIntervalSeconds"
        name="retryIntervalSeconds"
        type="number"
        :min="MIN_RETRY_INTERVAL_SECONDS"
        :max="MAX_RETRY_INTERVAL_SECONDS"
        :disabled="submitting"
    /></label>
    <label class="checkbox-field"
      ><input
        v-model="form.enabled"
        name="scheduleEnabled"
        type="checkbox"
        :disabled="submitting"
      />Schedule enabled</label
    >
    <p class="form-note form-actions--full">
      “Schedule enabled” controls only this business schedule. It does not enable the Runtime
      Scheduler or Real Send Authorization.
    </p>
    <p v-if="form.enabled && !schedule.enabled" class="form-note form-actions--full">
      Enabling this schedule affects future eligibility only; saving does not trigger a scheduler
      tick or run.
    </p>
    <p v-if="validationError || serverError" class="form-error form-actions--full" role="alert">
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
        Reset
      </button>
    </div>
  </form>
</template>

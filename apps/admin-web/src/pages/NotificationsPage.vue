<script setup lang="ts">
import { reactive, watch } from 'vue';

import { ApiError } from '../api/client';
import { useAdminApp } from '../appContext';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import { useMutation } from '../composables/useMutation';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import type { NotificationConfiguration, NotificationConfigurationInput } from '../types/api';

const app = useAdminApp();
const configuration = useRequest((signal) => app.api.getNotificationConfiguration(signal));
const saveMutation = useMutation();
const testMutation = useMutation();
const form = reactive<NotificationConfigurationInput>({
  enabled: false,
  provider: 'WEBHOOK',
  webhookUrl: null,
  notifyAuthExpired: true,
  notifyTaskFailed: true,
  notifyConsecutiveFailure: true,
  notifyDeliveryUnknown: true,
});

watch(configuration.data, (value) => {
  if (value !== null) applyConfiguration(value);
});
watch(app.refreshVersion, () => void configuration.load());
useRealtimeRefresh(
  app.realtime,
  (event) => event.type === 'CONFIG_CHANGED' && event.data.entityType === 'NOTIFICATION',
  () => void configuration.load(),
);

function applyConfiguration(value: NotificationConfiguration): void {
  Object.assign(form, {
    enabled: value.enabled,
    provider: value.provider,
    webhookUrl: value.webhookUrl,
    notifyAuthExpired: value.notifyAuthExpired,
    notifyTaskFailed: value.notifyTaskFailed,
    notifyConsecutiveFailure: value.notifyConsecutiveFailure,
    notifyDeliveryUnknown: value.notifyDeliveryUnknown,
  });
}

async function saveConfiguration(): Promise<void> {
  const webhookUrl = form.webhookUrl?.trim() ?? '';
  if (form.enabled && webhookUrl.length === 0) {
    saveMutation.error.value = 'Webhook URL is required while notifications are enabled.';
    return;
  }
  await saveMutation.execute(
    () =>
      app.api.updateNotificationConfiguration({
        ...form,
        webhookUrl: webhookUrl.length === 0 ? null : webhookUrl,
      }),
    (saved) => {
      applyConfiguration(saved);
    },
    'Notification configuration saved.',
  );
}

async function sendTestNotification(): Promise<void> {
  await testMutation.execute(
    () => app.api.sendTestNotification(),
    (result) => {
      if (result.status === 'SENT') return;
      const message =
        result.status === 'BLOCKED'
          ? 'Test notification was blocked by the destination safety policy or configuration.'
          : 'Test notification delivery failed after bounded attempts.';
      throw new ApiError('NOTIFICATION_DELIVERY_FAILED', message, 0, 'API');
    },
    'Test notification delivered to the configured Webhook.',
  );
}

function resetForm(): void {
  if (configuration.data.value !== null) applyConfiguration(configuration.data.value);
  saveMutation.clearError();
}
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Notifications</p>
        <h2>Webhook notifications</h2>
        <p>Send selected high-value runtime summaries to one validated Webhook destination.</p>
      </div>
      <button class="button button--secondary" type="button" @click="configuration.load">
        Refresh
      </button>
    </header>

    <p class="notice-card template-privacy-note">
      Webhook delivery sends only a safe runtime summary. It never includes contact names, message
      content, credentials, evidence paths, raw errors, or database details. Treat a URL containing
      a query secret as sensitive configuration.
    </p>

    <LoadingState
      v-if="configuration.loading.value && configuration.data.value === null"
      label="Loading notification configuration…"
    />
    <ErrorState
      v-else-if="configuration.error.value"
      :message="configuration.error.value.message"
      @retry="configuration.load"
    />
    <section v-else-if="configuration.data.value" class="card" aria-labelledby="webhook-settings">
      <div class="card__header">
        <div>
          <p class="eyebrow">Provider</p>
          <h3 id="webhook-settings">WEBHOOK</h3>
          <p>Notification failures remain non-critical and never change task results.</p>
        </div>
      </div>

      <form class="config-form notification-form" novalidate @submit.prevent="saveConfiguration">
        <label class="checkbox-field">
          <input
            v-model="form.enabled"
            name="notificationEnabled"
            type="checkbox"
            :disabled="saveMutation.submitting.value"
          />
          Notifications enabled
        </label>

        <label>
          Webhook URL
          <input
            v-model="form.webhookUrl"
            name="webhookUrl"
            type="text"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://…"
            :disabled="saveMutation.submitting.value"
          />
          <small
            >HTTP(S) only. Local, private, link-local, and mixed DNS destinations are
            blocked.</small
          >
        </label>

        <fieldset class="message-fields">
          <legend>Events</legend>
          <label class="checkbox-field">
            <input
              v-model="form.notifyAuthExpired"
              name="notifyAuthExpired"
              type="checkbox"
              :disabled="saveMutation.submitting.value"
            />
            AUTH_EXPIRED
          </label>
          <label class="checkbox-field">
            <input
              v-model="form.notifyTaskFailed"
              name="notifyTaskFailed"
              type="checkbox"
              :disabled="saveMutation.submitting.value"
            />
            TASK_FAILED
          </label>
          <label class="checkbox-field">
            <input
              v-model="form.notifyConsecutiveFailure"
              name="notifyConsecutiveFailure"
              type="checkbox"
              :disabled="saveMutation.submitting.value"
            />
            CONSECUTIVE_RUN_FAILURE
          </label>
          <label class="checkbox-field">
            <input
              v-model="form.notifyDeliveryUnknown"
              name="notifyDeliveryUnknown"
              type="checkbox"
              :disabled="saveMutation.submitting.value"
            />
            DELIVERY_UNKNOWN
          </label>
        </fieldset>

        <p v-if="saveMutation.error.value" class="form-error" role="alert">
          {{ saveMutation.error.value }}
        </p>
        <p v-if="saveMutation.success.value" class="success-message" role="status">
          {{ saveMutation.success.value }}
        </p>
        <p v-if="testMutation.error.value" class="form-error" role="alert">
          {{ testMutation.error.value }}
        </p>
        <p v-if="testMutation.success.value" class="success-message" role="status">
          {{ testMutation.success.value }}
        </p>

        <div class="form-actions">
          <button
            class="button button--primary"
            type="submit"
            :disabled="saveMutation.submitting.value"
          >
            {{ saveMutation.submitting.value ? 'Saving…' : 'Save notifications' }}
          </button>
          <button
            class="button button--secondary"
            type="button"
            :disabled="saveMutation.submitting.value"
            @click="resetForm"
          >
            Reset
          </button>
          <button
            class="button button--secondary"
            type="button"
            :disabled="
              testMutation.submitting.value || configuration.data.value.webhookUrl === null
            "
            @click="sendTestNotification"
          >
            {{ testMutation.submitting.value ? 'Sending test…' : 'Send test notification' }}
          </button>
        </div>
        <p class="form-note">
          Test Notification sends one fixed SparkKeeper test summary to the currently saved URL. It
          cannot send user-supplied content and does not access Douyin.
        </p>
      </form>
    </section>
  </div>
</template>

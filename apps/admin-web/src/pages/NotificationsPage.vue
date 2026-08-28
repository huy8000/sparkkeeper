<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';

import { ApiError } from '../api/client';
import { REALTIME_REFRESH_DELAY_MS } from '../api/realtimePolicy';
import { useAdminApp } from '../appContext';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import DangerConfirmation from '../components/DangerConfirmation.vue';
import FormField from '../components/FormField.vue';
import InlineError from '../components/InlineError.vue';
import NotificationTestResult from '../components/notification/NotificationTestResult.vue';
import PageError from '../components/PageError.vue';
import Skeleton from '../components/Skeleton.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useDebouncedAction } from '../composables/useDebouncedAction';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import {
  isNotificationConfigured,
  notificationDraftFrom,
  notificationDraftMatches,
  notificationInputFrom,
  validateNotificationDraft,
  type NotificationDraft,
} from '../operations/notificationModel';
import type {
  NotificationConfiguration,
  NotificationDeliveryResult,
  RealtimeEvent,
} from '../types/api';

const app = useAdminApp();
const toasts = useToasts();
const configurationRequest = useRequest((signal) => app.api.getNotificationConfiguration(signal));
const configuration = ref<NotificationConfiguration | null>(null);
const form = reactive<NotificationDraft>({
  enabled: false,
  provider: 'WEBHOOK',
  webhookUrl: '',
  notifyAuthExpired: true,
  notifyTaskFailed: true,
  notifyConsecutiveFailure: true,
  notifyDeliveryUnknown: true,
});
const saving = ref(false);
const saveError = ref('');
const serverChanged = ref(false);
const reloadConfirmationOpen = ref(false);
const testing = ref(false);
const testError = ref('');
const testResult = ref<NotificationDeliveryResult | null>(null);
const testUncertain = ref(false);
let applyNextResponse = false;

const dirty = computed(
  () => configuration.value !== null && !notificationDraftMatches(form, configuration.value),
);
const configured = computed(
  () => configuration.value !== null && isNotificationConfigured(configuration.value),
);
const canTest = computed(() => configured.value && !testing.value && !saving.value);

watch(configurationRequest.data, (next) => {
  if (next === null) return;
  const preserveDraft = dirty.value && !applyNextResponse;
  configuration.value = next;
  if (preserveDraft) {
    serverChanged.value = true;
  } else {
    applyConfiguration(next);
    serverChanged.value = false;
  }
  applyNextResponse = false;
});

watch(app.refreshVersion, () => void configurationRequest.load());

const realtimeRefresh = useDebouncedAction(() => {
  if (dirty.value) {
    serverChanged.value = true;
    return;
  }
  void configurationRequest.load();
}, REALTIME_REFRESH_DELAY_MS);
const unsubscribeRealtime = app.realtime.subscribe((event) => {
  if (isNotificationConfigurationEvent(event)) realtimeRefresh.trigger();
});

function isNotificationConfigurationEvent(
  event: RealtimeEvent,
): event is Extract<RealtimeEvent, { type: 'CONFIG_CHANGED' }> {
  return event.type === 'CONFIG_CHANGED' && event.data.entityType === 'NOTIFICATION';
}

function applyConfiguration(value: NotificationConfiguration): void {
  Object.assign(form, notificationDraftFrom(value));
  saveError.value = '';
}

async function saveConfiguration(): Promise<void> {
  if (saving.value) return;
  const validationError = validateNotificationDraft(form);
  if (validationError !== '') {
    saveError.value = validationError;
    return;
  }
  saving.value = true;
  saveError.value = '';
  try {
    const saved = await app.api.updateNotificationConfiguration(notificationInputFrom(form));
    configuration.value = saved;
    applyConfiguration(saved);
    serverChanged.value = false;
    testResult.value = null;
    testUncertain.value = false;
    testError.value = '';
    toasts.notify('success', 'Notification settings saved.');
  } catch (error) {
    saveError.value =
      error instanceof ApiError ? error.message : 'Notification settings could not be saved.';
    toasts.notify('error', 'Notification settings could not be saved.');
  } finally {
    saving.value = false;
  }
}

function resetForm(): void {
  if (configuration.value === null || saving.value) return;
  applyConfiguration(configuration.value);
  serverChanged.value = false;
}

function requestServerReload(): void {
  if (saving.value) return;
  if (dirty.value) reloadConfirmationOpen.value = true;
  else void configurationRequest.load();
}

async function confirmServerReload(): Promise<void> {
  reloadConfirmationOpen.value = false;
  applyNextResponse = true;
  await configurationRequest.load();
  if (configurationRequest.error.value !== null) applyNextResponse = false;
}

async function sendTestNotification(): Promise<void> {
  if (!canTest.value) return;
  testing.value = true;
  testError.value = '';
  testResult.value = null;
  testUncertain.value = false;
  try {
    const result = await app.api.sendTestNotification();
    testResult.value = result;
    if (result.status === 'SENT') toasts.notify('success', 'Test notification sent.');
    else if (result.status === 'FAILED') toasts.notify('error', 'Test notification failed.');
    else toasts.notify('warning', 'Test notification blocked.');
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'NETWORK') {
      testUncertain.value = true;
      toasts.notify('warning', 'Test request result is uncertain.');
    } else {
      testError.value =
        error instanceof ApiError ? error.message : 'The test notification could not be sent.';
      toasts.notify('error', 'The test notification could not be sent.');
    }
  } finally {
    testing.value = false;
  }
}

onBeforeUnmount(() => {
  unsubscribeRealtime();
  realtimeRefresh.cancel();
});
</script>

<template>
  <div class="page-stack notifications-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Operations</p>
        <h2>Notifications</h2>
        <p>Configure webhook notifications for important SparkKeeper events.</p>
      </div>
      <button
        class="button button--secondary"
        type="button"
        :disabled="configurationRequest.loading.value"
        @click="configurationRequest.load"
      >
        Refresh
      </button>
    </header>

    <section class="notification-summary" aria-label="Notification configuration summary">
      <div>
        <span>Notifications</span>
        <StatusBadge v-if="configuration === null" status="UNKNOWN" label="Checking…" />
        <StatusBadge v-else :status="configuration.enabled ? 'ENABLED' : 'DISABLED'" />
      </div>
      <div>
        <span>Provider</span>
        <strong>Webhook</strong>
      </div>
      <div>
        <span>Destination</span>
        <StatusBadge
          :status="configured ? 'READY' : 'NOT_READY'"
          :label="configured ? 'Configured' : 'Not configured'"
        />
      </div>
    </section>

    <BackgroundRefreshIndicator v-if="configurationRequest.refreshing.value" />
    <StaleDataNotice
      v-if="configurationRequest.refreshError.value"
      :message="configurationRequest.refreshError.value.message"
      @retry="configurationRequest.load"
    />

    <section class="template-privacy-note notification-privacy-note" aria-label="Webhook privacy">
      <span aria-hidden="true">◇</span>
      <p>
        Webhook URLs may contain sensitive tokens. They are shown only in this local editor and are
        never copied into status summaries, test results, routes, or notifications.
      </p>
    </section>

    <section
      v-if="configurationRequest.loading.value && configuration === null"
      class="notification-skeleton"
      aria-label="Loading notification configuration"
      aria-busy="true"
    >
      <Skeleton width="34%" height="20px" label="Loading notification heading…" />
      <Skeleton height="52px" label="Loading notification destination…" />
      <Skeleton height="180px" label="Loading notification events…" />
    </section>

    <PageError
      v-else-if="configurationRequest.error.value && configuration === null"
      title="Unable to load notification settings"
      :message="configurationRequest.error.value.message"
      @retry="configurationRequest.load"
    />

    <template v-else-if="configuration">
      <section v-if="serverChanged" class="notification-server-change" role="status">
        <div>
          <strong>Notification settings changed on the server.</strong>
          <span>Your unsaved values have not been replaced.</span>
        </div>
        <button
          class="button button--secondary button--compact"
          type="button"
          @click="requestServerReload"
        >
          Reload
        </button>
      </section>

      <section class="card notification-config-card" aria-labelledby="notification-settings-title">
        <header class="card__header">
          <div>
            <p class="eyebrow">{{ configured ? 'Configured' : 'Setup required' }}</p>
            <h3 id="notification-settings-title">Webhook configuration</h3>
            <p>
              {{
                configured
                  ? 'Save explicitly after making changes.'
                  : 'Add a destination before sending a test notification.'
              }}
            </p>
          </div>
          <span v-if="dirty" class="unsaved-indicator" role="status">Unsaved changes</span>
        </header>

        <form class="notification-form" novalidate @submit.prevent="saveConfiguration">
          <label class="notification-enable-card">
            <span>
              <strong>Notifications enabled</strong>
              <small>Allow selected runtime events to use the configured webhook.</small>
            </span>
            <input
              v-model="form.enabled"
              name="notificationEnabled"
              type="checkbox"
              :disabled="saving"
            />
          </label>

          <div class="notification-destination-grid">
            <FormField label="Provider" help-text="The current backend supports Webhook only.">
              <template #default="{ fieldId, describedBy }">
                <select
                  :id="fieldId"
                  v-model="form.provider"
                  name="provider"
                  :aria-describedby="describedBy"
                  disabled
                >
                  <option value="WEBHOOK">Webhook</option>
                </select>
              </template>
            </FormField>
            <FormField
              label="Webhook URL"
              help-text="HTTP(S) only. Private and unsafe destinations are rejected by the server."
              :error="saveError.includes('Webhook URL is required') ? saveError : ''"
            >
              <template #default="{ fieldId, describedBy }">
                <input
                  :id="fieldId"
                  v-model="form.webhookUrl"
                  name="webhookUrl"
                  type="text"
                  inputmode="url"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="https://example.invalid/webhook"
                  :aria-describedby="describedBy"
                  :disabled="saving"
                />
              </template>
            </FormField>
          </div>

          <fieldset class="notification-events">
            <legend>Events</legend>
            <label>
              <input
                v-model="form.notifyAuthExpired"
                name="notifyAuthExpired"
                type="checkbox"
                :disabled="saving"
              />
              <span><strong>Login expired</strong><small>AUTH_EXPIRED</small></span>
            </label>
            <label>
              <input
                v-model="form.notifyTaskFailed"
                name="notifyTaskFailed"
                type="checkbox"
                :disabled="saving"
              />
              <span><strong>Run task failed</strong><small>TASK_FAILED</small></span>
            </label>
            <label>
              <input
                v-model="form.notifyConsecutiveFailure"
                name="notifyConsecutiveFailure"
                type="checkbox"
                :disabled="saving"
              />
              <span
                ><strong>Consecutive run failures</strong
                ><small>CONSECUTIVE_RUN_FAILURE</small></span
              >
            </label>
            <label>
              <input
                v-model="form.notifyDeliveryUnknown"
                name="notifyDeliveryUnknown"
                type="checkbox"
                :disabled="saving"
              />
              <span><strong>Delivery uncertain</strong><small>DELIVERY_UNKNOWN</small></span>
            </label>
          </fieldset>

          <InlineError
            v-if="saveError && !saveError.includes('Webhook URL is required')"
            :message="saveError"
          />
          <div class="form-actions">
            <button class="button button--primary" type="submit" :disabled="saving || !dirty">
              {{ saving ? 'Saving…' : 'Save settings' }}
            </button>
            <button
              class="button button--secondary"
              type="button"
              :disabled="saving || !dirty"
              @click="resetForm"
            >
              Reset saved values
            </button>
          </div>
        </form>
      </section>

      <section class="card notification-test-card" aria-labelledby="notification-test-title">
        <header class="card__header">
          <div>
            <p class="eyebrow">Test notification</p>
            <h3 id="notification-test-title">Verify the saved destination</h3>
            <p>This sends a real webhook request when connected to a real runtime.</p>
          </div>
          <button
            class="button button--secondary"
            type="button"
            :disabled="!canTest"
            @click="sendTestNotification"
          >
            {{ testing ? 'Sending test…' : 'Send test notification' }}
          </button>
        </header>
        <p class="form-note">
          The server sends one fixed SparkKeeper test summary to the currently saved URL. Unsaved
          form values are never used.
        </p>
        <p v-if="!configured" class="notification-test-hint">
          Save a valid webhook URL before sending a test.
        </p>
        <InlineError v-if="testError" :message="testError" />
        <NotificationTestResult :result="testResult" :uncertain="testUncertain" />
      </section>
    </template>

    <DangerConfirmation
      :open="reloadConfirmationOpen"
      title="Reload notification settings?"
      description="Reloading will replace your unsaved values with the latest server configuration."
      confirm-label="Discard and reload"
      cancel-label="Keep editing"
      @close="reloadConfirmationOpen = false"
      @confirm="confirmServerReload"
    />
  </div>
</template>

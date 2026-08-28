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
import { useTranslation } from '../i18n';
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
const { t } = useTranslation();
const WEBHOOK_REQUIRED_KEY = 'notificationsPage.validation.webhookRequired';
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
// Client validation keys/strings pass through untouched; ApiError snapshots
// localize at render time. The WEBHOOK_REQUIRED_KEY sentinel stays a string.
const saveError = ref<ApiError | string>('');
const serverChanged = ref(false);
const reloadConfirmationOpen = ref(false);
const testing = ref(false);
const testError = ref<ApiError | string>('');
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
const webhookFieldError = computed(() =>
  saveError.value === WEBHOOK_REQUIRED_KEY ? t(WEBHOOK_REQUIRED_KEY) : '',
);

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
    toasts.notify('success', t('notificationsPage.savedToast'));
  } catch (error) {
    saveError.value = error instanceof ApiError ? error : t('notificationsPage.saveErrorToast');
    toasts.notify('error', t('notificationsPage.saveErrorToast'));
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
    if (result.status === 'SENT') toasts.notify('success', t('notificationsPage.testSentToast'));
    else if (result.status === 'FAILED')
      toasts.notify('error', t('notificationsPage.testFailedToast'));
    else toasts.notify('warning', t('notificationsPage.testBlockedToast'));
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'NETWORK') {
      testUncertain.value = true;
      toasts.notify('warning', t('notificationsPage.testUncertainToast'));
    } else {
      testError.value = error instanceof ApiError ? error : t('notificationsPage.testSendError');
      toasts.notify('error', t('notificationsPage.testSendError'));
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
        <p class="eyebrow">{{ t('nav.operations') }}</p>
        <h2>{{ t('nav.notifications') }}</h2>
        <p>{{ t('notificationsPage.subtitle') }}</p>
      </div>
      <button
        class="button button--secondary"
        type="button"
        :disabled="configurationRequest.loading.value"
        @click="configurationRequest.load"
      >
        {{ t('common.refresh') }}
      </button>
    </header>

    <section class="notification-summary" :aria-label="t('notificationsPage.summaryAria')">
      <div>
        <span>{{ t('notificationsPage.summaryNotifications') }}</span>
        <StatusBadge
          v-if="configuration === null"
          status="UNKNOWN"
          :label="t('notificationsPage.checking')"
        />
        <StatusBadge v-else :status="configuration.enabled ? 'ENABLED' : 'DISABLED'" />
      </div>
      <div>
        <span>{{ t('notificationsPage.provider') }}</span>
        <strong>Webhook</strong>
      </div>
      <div>
        <span>{{ t('notificationsPage.destination') }}</span>
        <StatusBadge
          :status="configured ? 'READY' : 'NOT_READY'"
          :label="
            configured ? t('notificationsPage.configured') : t('notificationsPage.notConfigured')
          "
        />
      </div>
    </section>

    <BackgroundRefreshIndicator v-if="configurationRequest.refreshing.value" />
    <StaleDataNotice
      v-if="configurationRequest.refreshError.value"
      :error="configurationRequest.refreshError.value"
      @retry="configurationRequest.load"
    />

    <section
      class="template-privacy-note notification-privacy-note"
      :aria-label="t('notificationsPage.privacyAria')"
    >
      <span aria-hidden="true">◇</span>
      <p>
        {{ t('notificationsPage.privacyNote') }}
      </p>
    </section>

    <section
      v-if="configurationRequest.loading.value && configuration === null"
      class="notification-skeleton"
      :aria-label="t('notificationsPage.loadingAria')"
      aria-busy="true"
    >
      <Skeleton width="34%" height="20px" :label="t('notificationsPage.loadingHeading')" />
      <Skeleton height="52px" :label="t('notificationsPage.loadingDestination')" />
      <Skeleton height="180px" :label="t('notificationsPage.loadingEvents')" />
    </section>

    <PageError
      v-else-if="configurationRequest.error.value && configuration === null"
      :title="t('notificationsPage.errorTitle')"
      :error="configurationRequest.error.value"
      @retry="configurationRequest.load"
    />

    <template v-else-if="configuration">
      <section v-if="serverChanged" class="notification-server-change" role="status">
        <div>
          <strong>{{ t('notificationsPage.serverChangedTitle') }}</strong>
          <span>{{ t('notificationsPage.serverChangedBody') }}</span>
        </div>
        <button
          class="button button--secondary button--compact"
          type="button"
          @click="requestServerReload"
        >
          {{ t('account.reload') }}
        </button>
      </section>

      <section class="card notification-config-card" aria-labelledby="notification-settings-title">
        <header class="card__header">
          <div>
            <p class="eyebrow">
              {{
                configured
                  ? t('notificationsPage.configured')
                  : t('notificationsPage.cardEyebrowSetup')
              }}
            </p>
            <h3 id="notification-settings-title">{{ t('notificationsPage.cardTitle') }}</h3>
            <p>
              {{
                configured
                  ? t('notificationsPage.cardDescriptionConfigured')
                  : t('notificationsPage.cardDescriptionSetup')
              }}
            </p>
          </div>
          <span v-if="dirty" class="unsaved-indicator" role="status">{{
            t('notificationsPage.unsaved')
          }}</span>
        </header>

        <form class="notification-form" novalidate @submit.prevent="saveConfiguration">
          <label class="notification-enable-card">
            <span>
              <strong>{{ t('notificationsPage.enabledLabel') }}</strong>
              <small>{{ t('notificationsPage.enabledHint') }}</small>
            </span>
            <input
              v-model="form.enabled"
              name="notificationEnabled"
              type="checkbox"
              :disabled="saving"
            />
          </label>

          <div class="notification-destination-grid">
            <FormField
              :label="t('notificationsPage.providerLabel')"
              :help-text="t('notificationsPage.providerHelp')"
            >
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
              :label="t('notificationsPage.webhookLabel')"
              :help-text="t('notificationsPage.webhookHelp')"
              :error="webhookFieldError"
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
            <legend>{{ t('notificationsPage.eventsLegend') }}</legend>
            <label>
              <input
                v-model="form.notifyAuthExpired"
                name="notifyAuthExpired"
                type="checkbox"
                :disabled="saving"
              />
              <span
                ><strong>{{ t('notificationsPage.notifyAuthExpired') }}</strong
                ><small>AUTH_EXPIRED</small></span
              >
            </label>
            <label>
              <input
                v-model="form.notifyTaskFailed"
                name="notifyTaskFailed"
                type="checkbox"
                :disabled="saving"
              />
              <span
                ><strong>{{ t('notificationsPage.notifyTaskFailed') }}</strong
                ><small>TASK_FAILED</small></span
              >
            </label>
            <label>
              <input
                v-model="form.notifyConsecutiveFailure"
                name="notifyConsecutiveFailure"
                type="checkbox"
                :disabled="saving"
              />
              <span
                ><strong>{{ t('notificationsPage.notifyConsecutiveFailure') }}</strong
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
              <span
                ><strong>{{ t('notificationsPage.notifyDeliveryUnknown') }}</strong
                ><small>DELIVERY_UNKNOWN</small></span
              >
            </label>
          </fieldset>

          <InlineError v-if="saveError && saveError !== WEBHOOK_REQUIRED_KEY" :error="saveError" />
          <div class="form-actions">
            <button class="button button--primary" type="submit" :disabled="saving || !dirty">
              {{ saving ? t('notificationsPage.saving') : t('notificationsPage.save') }}
            </button>
            <button
              class="button button--secondary"
              type="button"
              :disabled="saving || !dirty"
              @click="resetForm"
            >
              {{ t('notificationsPage.reset') }}
            </button>
          </div>
        </form>
      </section>

      <section class="card notification-test-card" aria-labelledby="notification-test-title">
        <header class="card__header">
          <div>
            <p class="eyebrow">{{ t('notificationsPage.testEyebrow') }}</p>
            <h3 id="notification-test-title">{{ t('notificationsPage.testTitle') }}</h3>
            <p>{{ t('notificationsPage.testDescription') }}</p>
          </div>
          <button
            class="button button--secondary"
            type="button"
            :disabled="!canTest"
            @click="sendTestNotification"
          >
            {{ testing ? t('notificationsPage.testSending') : t('notificationsPage.testSend') }}
          </button>
        </header>
        <p class="form-note">
          {{ t('notificationsPage.testNote') }}
        </p>
        <p v-if="!configured" class="notification-test-hint">
          {{ t('notificationsPage.testHint') }}
        </p>
        <InlineError v-if="testError" :error="testError" />
        <NotificationTestResult :result="testResult" :uncertain="testUncertain" />
      </section>
    </template>

    <DangerConfirmation
      :open="reloadConfirmationOpen"
      :title="t('notificationsPage.reloadConfirmTitle')"
      :description="t('notificationsPage.reloadConfirmDescription')"
      :confirm-label="t('notificationsPage.reloadConfirmButton')"
      :cancel-label="t('account.keepEditing')"
      @close="reloadConfirmationOpen = false"
      @confirm="confirmServerReload"
    />
  </div>
</template>

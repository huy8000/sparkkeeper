<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { invalidatesWorkspaceSchedule } from '../api/accountWorkspaceInvalidation';
import { ApiError } from '../api/client';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import DangerConfirmation from '../components/DangerConfirmation.vue';
import Drawer from '../components/Drawer.vue';
import EmptyState from '../components/EmptyState.vue';
import InlineError from '../components/InlineError.vue';
import ScheduleForm from '../components/ScheduleForm.vue';
import SectionLoading from '../components/SectionLoading.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useApiErrorText } from '../composables/useApiErrorText';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import { useTranslation } from '../i18n';
import type { ConfigureScheduleInput } from '../types/api';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const toasts = useToasts();
const { t } = useTranslation();
const { apiErrorText } = useApiErrorText();
const schedules = useRequest((signal) => app.api.listSchedules(workspace.accountId.value, signal));
const drawerOpen = ref(false);
const submitting = ref(false);
const formError = ref<ApiError | string>('');
const formDirty = ref(false);
const serverChanged = ref(false);
const reloadConfirmationOpen = ref(false);
const schedule = computed(() => schedules.data.value?.[0] ?? null);

watch(workspace.accountId, () => {
  drawerOpen.value = false;
  formDirty.value = false;
  serverChanged.value = false;
  schedules.reset();
  void schedules.load();
});
watch(app.refreshVersion, () => void refreshSchedules());
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesWorkspaceSchedule(event, workspace.accountId.value),
  () => void refreshSchedules(),
);

function openForm(): void {
  formError.value = '';
  formDirty.value = false;
  serverChanged.value = false;
  drawerOpen.value = true;
}

function closeForm(): void {
  if (submitting.value) return;
  drawerOpen.value = false;
  formError.value = '';
  formDirty.value = false;
  serverChanged.value = false;
  reloadConfirmationOpen.value = false;
}

async function refreshSchedules(force = false): Promise<void> {
  if (!force && drawerOpen.value && formDirty.value) {
    serverChanged.value = true;
    return;
  }
  await schedules.load();
}

function requestServerReload(): void {
  if (formDirty.value) reloadConfirmationOpen.value = true;
  else void refreshSchedules(true);
}

async function confirmServerReload(): Promise<void> {
  reloadConfirmationOpen.value = false;
  await refreshSchedules(true);
  if (schedules.error.value === null) serverChanged.value = false;
}

async function saveSchedule(input: ConfigureScheduleInput): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  formError.value = '';
  try {
    await app.api.configureSchedule(workspace.accountId.value, input);
    await refreshSchedules(true);
    drawerOpen.value = false;
    toasts.notify('success', t('scheduleTab.savedToast'));
  } catch (error) {
    formError.value = error instanceof ApiError ? error : t('scheduleTab.saveErrorToast');
    toasts.notify('error', t('scheduleTab.saveErrorToast'));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page-stack account-tab-page">
    <header class="account-tab-heading">
      <div>
        <p class="eyebrow">{{ t('scheduleTab.eyebrow') }}</p>
        <h3>{{ t('scheduleTab.title') }}</h3>
        <p>{{ t('scheduleTab.subtitle') }}</p>
      </div>
      <button class="button button--primary" type="button" @click="openForm">
        {{ schedule ? t('scheduleTab.edit') : t('scheduleTab.configure') }}
      </button>
    </header>

    <section class="schedule-semantics" aria-labelledby="schedule-semantics-title">
      <div>
        <p class="eyebrow">{{ t('scheduleTab.semanticsEyebrow') }}</p>
        <h3 id="schedule-semantics-title">{{ t('scheduleTab.semanticsTitle') }}</h3>
        <p>
          {{ t('scheduleTab.semanticsDescription') }}
        </p>
      </div>
      <dl class="schedule-runtime-gates">
        <div>
          <dt>{{ t('scheduleTab.runtimeScheduler') }}</dt>
          <dd>
            <StatusBadge
              v-if="app.runtime.data.value"
              :status="app.runtime.data.value.schedulerEnabled ? 'ENABLED' : 'DISABLED'"
            />
            <span v-else>{{ t('scheduleTab.unavailable') }}</span>
          </dd>
        </div>
        <div>
          <dt>{{ t('scheduleTab.realSendAuthorization') }}</dt>
          <dd>
            <StatusBadge
              v-if="app.runtime.data.value"
              :status="app.runtime.data.value.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'"
            />
            <span v-else>{{ t('scheduleTab.unavailable') }}</span>
          </dd>
        </div>
      </dl>
    </section>

    <BackgroundRefreshIndicator v-if="schedules.refreshing.value" />
    <StaleDataNotice
      v-if="schedules.refreshError.value"
      :error="schedules.refreshError.value"
      @retry="refreshSchedules(true)"
    />

    <SectionLoading
      v-if="schedules.loading.value && schedules.data.value === null"
      :label="t('scheduleTab.loading')"
    />
    <section v-else-if="schedules.initialError.value" class="section-error-stack">
      <InlineError :error="schedules.initialError.value" />
      <button class="button button--secondary" type="button" @click="schedules.load">
        {{ t('common.retry') }}
      </button>
    </section>
    <EmptyState
      v-else-if="schedule === null"
      :title="t('scheduleTab.emptyTitle')"
      :description="t('scheduleTab.emptyDescription')"
    >
      <template #action>
        <button class="button button--primary" type="button" @click="openForm">
          {{ t('scheduleTab.configure') }}
        </button>
      </template>
    </EmptyState>
    <section v-else class="schedule-configuration" aria-labelledby="schedule-config-title">
      <header class="card__header">
        <div>
          <p class="eyebrow">{{ t('scheduleTab.currentEyebrow') }}</p>
          <h3 id="schedule-config-title">{{ schedule.startTime }}–{{ schedule.endTime }}</h3>
        </div>
        <StatusBadge :status="schedule.enabled ? 'ENABLED' : 'DISABLED'" />
      </header>
      <div class="schedule-window-visual" :aria-label="t('scheduleTab.windowAria')">
        <span>{{ schedule.startTime }}</span>
        <span class="schedule-window-visual__line" aria-hidden="true" />
        <span>{{ schedule.endTime }}</span>
      </div>
      <dl class="definition-grid">
        <div>
          <dt>{{ t('scheduleTab.timezone') }}</dt>
          <dd>{{ schedule.timezone }}</dd>
        </div>
        <div>
          <dt>{{ t('scheduleTab.maxAttempts') }}</dt>
          <dd>{{ schedule.maxAttempts }}</dd>
        </div>
        <div>
          <dt>{{ t('scheduleTab.retryInterval') }}</dt>
          <dd>{{ t('scheduleTab.seconds', { n: schedule.retryIntervalSeconds }) }}</dd>
        </div>
        <div>
          <dt>{{ t('scheduleTab.scheduleEnabled') }}</dt>
          <dd>{{ schedule.enabled ? t('common.yes') : t('common.no') }}</dd>
        </div>
      </dl>
    </section>

    <Drawer
      :open="drawerOpen"
      :title="schedule ? t('scheduleTab.edit') : t('scheduleTab.configure')"
      @close="closeForm"
    >
      <p class="drawer-intro">{{ t('scheduleTab.drawerIntro') }}</p>
      <section v-if="serverChanged" class="notification-server-change" role="status">
        <div>
          <strong>{{ t('scheduleTab.serverChangedTitle') }}</strong>
          <span>{{ t('scheduleTab.serverChangedBody') }}</span>
        </div>
        <button
          class="button button--secondary button--compact"
          type="button"
          @click="requestServerReload"
        >
          {{ t('scheduleTab.reload') }}
        </button>
      </section>
      <ScheduleForm
        :schedule="schedule ?? undefined"
        :default-timezone="app.runtime.data.value?.timezone ?? 'UTC'"
        :submitting="submitting"
        :server-error="apiErrorText(formError)"
        @submit="saveSchedule"
        @cancel="closeForm"
        @dirty-change="formDirty = $event"
      />
    </Drawer>

    <DangerConfirmation
      :open="reloadConfirmationOpen"
      :title="t('scheduleTab.reloadConfirmTitle')"
      :description="t('scheduleTab.reloadConfirmDescription')"
      :confirm-label="t('scheduleTab.reloadConfirmButton')"
      :cancel-label="t('scheduleTab.keepEditing')"
      @close="reloadConfirmationOpen = false"
      @confirm="confirmServerReload"
    />
  </div>
</template>

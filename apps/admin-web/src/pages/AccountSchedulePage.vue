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
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import type { ConfigureScheduleInput } from '../types/api';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const toasts = useToasts();
const schedules = useRequest((signal) => app.api.listSchedules(workspace.accountId.value, signal));
const drawerOpen = ref(false);
const submitting = ref(false);
const formError = ref('');
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
    toasts.notify('success', 'Schedule configuration saved.');
  } catch (error) {
    formError.value =
      error instanceof ApiError ? error.message : 'Schedule configuration could not be saved.';
    toasts.notify('error', 'Schedule configuration could not be saved.');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page-stack account-tab-page">
    <header class="account-tab-heading">
      <div>
        <p class="eyebrow">Schedule</p>
        <h3>Automatic execution window</h3>
        <p>The account has zero or one schedule configuration.</p>
      </div>
      <button class="button button--primary" type="button" @click="openForm">
        {{ schedule ? 'Edit schedule' : 'Configure schedule' }}
      </button>
    </header>

    <section class="schedule-semantics" aria-labelledby="schedule-semantics-title">
      <div>
        <p class="eyebrow">Important</p>
        <h3 id="schedule-semantics-title">Automatic Scheduler semantics</h3>
        <p>
          The schedule window constrains automatic Scheduler execution. Manual Run uses server
          preflight for the same BusinessDate and does not require the current time to be inside the
          window.
        </p>
      </div>
      <dl class="schedule-runtime-gates">
        <div>
          <dt>Runtime Scheduler</dt>
          <dd>
            <StatusBadge
              v-if="app.runtime.data.value"
              :status="app.runtime.data.value.schedulerEnabled ? 'ENABLED' : 'DISABLED'"
            />
            <span v-else>Unavailable</span>
          </dd>
        </div>
        <div>
          <dt>Real send authorization</dt>
          <dd>
            <StatusBadge
              v-if="app.runtime.data.value"
              :status="app.runtime.data.value.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'"
            />
            <span v-else>Unavailable</span>
          </dd>
        </div>
      </dl>
    </section>

    <BackgroundRefreshIndicator v-if="schedules.refreshing.value" />
    <StaleDataNotice
      v-if="schedules.refreshError.value"
      :message="schedules.refreshError.value.message"
      @retry="refreshSchedules(true)"
    />

    <SectionLoading
      v-if="schedules.loading.value && schedules.data.value === null"
      label="Loading schedule…"
    />
    <section v-else-if="schedules.initialError.value" class="section-error-stack">
      <InlineError :message="schedules.initialError.value.message" />
      <button class="button button--secondary" type="button" @click="schedules.load">Retry</button>
    </section>
    <EmptyState
      v-else-if="schedule === null"
      title="No schedule configured"
      description="Configure an automatic execution window and retry policy for this account."
    >
      <template #action>
        <button class="button button--primary" type="button" @click="openForm">
          Configure schedule
        </button>
      </template>
    </EmptyState>
    <section v-else class="schedule-configuration" aria-labelledby="schedule-config-title">
      <header class="card__header">
        <div>
          <p class="eyebrow">Current configuration</p>
          <h3 id="schedule-config-title">{{ schedule.startTime }}–{{ schedule.endTime }}</h3>
        </div>
        <StatusBadge :status="schedule.enabled ? 'ENABLED' : 'DISABLED'" />
      </header>
      <div class="schedule-window-visual" aria-label="Configured execution window">
        <span>{{ schedule.startTime }}</span>
        <span class="schedule-window-visual__line" aria-hidden="true" />
        <span>{{ schedule.endTime }}</span>
      </div>
      <dl class="definition-grid">
        <div>
          <dt>Timezone</dt>
          <dd>{{ schedule.timezone }}</dd>
        </div>
        <div>
          <dt>Maximum attempts</dt>
          <dd>{{ schedule.maxAttempts }}</dd>
        </div>
        <div>
          <dt>Retry interval</dt>
          <dd>{{ schedule.retryIntervalSeconds }} seconds</dd>
        </div>
        <div>
          <dt>Schedule enabled</dt>
          <dd>{{ schedule.enabled ? 'Yes' : 'No' }}</dd>
        </div>
      </dl>
    </section>

    <Drawer
      :open="drawerOpen"
      :title="schedule ? 'Edit schedule' : 'Configure schedule'"
      @close="closeForm"
    >
      <p class="drawer-intro">Saving configuration does not start the Scheduler or a run.</p>
      <section v-if="serverChanged" class="notification-server-change" role="status">
        <div>
          <strong>Schedule settings changed on the server.</strong>
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
      <ScheduleForm
        :schedule="schedule ?? undefined"
        :default-timezone="app.runtime.data.value?.timezone ?? 'UTC'"
        :submitting="submitting"
        :server-error="formError"
        @submit="saveSchedule"
        @cancel="closeForm"
        @dirty-change="formDirty = $event"
      />
    </Drawer>

    <DangerConfirmation
      :open="reloadConfirmationOpen"
      title="Reload schedule settings?"
      description="Reloading will replace your unsaved values with the latest server configuration."
      confirm-label="Discard and reload"
      cancel-label="Keep editing"
      @close="reloadConfirmationOpen = false"
      @confirm="confirmServerReload"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import {
  invalidatesWorkspacePreflight,
  invalidatesWorkspaceTemplates,
} from '../api/accountWorkspaceInvalidation';
import { ApiError } from '../api/client';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import DangerConfirmation from '../components/DangerConfirmation.vue';
import EmptyState from '../components/EmptyState.vue';
import FormField from '../components/FormField.vue';
import InlineError from '../components/InlineError.vue';
import SectionLoading from '../components/SectionLoading.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import ManualRunPreflight from '../components/account/ManualRunPreflight.vue';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import type { ManualRunAccepted, ManualRunPreflight as ManualRunPreflightDto } from '../types/api';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const templates = useRequest((signal) => app.api.listTemplates(signal));
const selectedTemplateId = ref('');
const preflight = ref<ManualRunPreflightDto | null>(null);
const preflightLoading = ref(false);
const preflightError = ref('');
const acknowledged = ref(false);
const confirmationOpen = ref(false);
const submitting = ref(false);
const requestUncertain = ref(false);
const accepted = ref<ManualRunAccepted | null>(null);
let controller: InstanceType<typeof globalThis.AbortController> | undefined;
let requestNumber = 0;

const selectedTemplate = computed(() =>
  templates.data.value?.find((template) => template.id === selectedTemplateId.value),
);

watch(app.refreshVersion, () => {
  void templates.load();
  void refreshPreflight();
});
watch(workspace.accountId, () => {
  cancelPreflight();
  requestNumber += 1;
  selectedTemplateId.value = '';
  preflight.value = null;
  preflightError.value = '';
  acknowledged.value = false;
  confirmationOpen.value = false;
  accepted.value = null;
  requestUncertain.value = false;
});
useRealtimeRefresh(app.realtime, invalidatesWorkspaceTemplates, () => void templates.load());
useRealtimeRefresh(
  app.realtime,
  (event) =>
    selectedTemplateId.value !== '' &&
    invalidatesWorkspacePreflight(event, workspace.accountId.value, selectedTemplateId.value),
  () => void refreshPreflight(),
);

function cancelPreflight(): void {
  controller?.abort();
  controller = undefined;
}

async function chooseTemplate(): Promise<void> {
  accepted.value = null;
  requestUncertain.value = false;
  confirmationOpen.value = false;
  acknowledged.value = false;
  preflight.value = null;
  preflightError.value = '';
  await refreshPreflight();
}

async function refreshPreflight(): Promise<void> {
  if (selectedTemplateId.value === '' || accepted.value !== null || requestUncertain.value) return;
  cancelPreflight();
  const currentRequest = ++requestNumber;
  const requestController = new globalThis.AbortController();
  controller = requestController;
  preflightLoading.value = true;
  preflightError.value = '';
  try {
    const result = await app.api.getManualRunPreflight(
      workspace.accountId.value,
      selectedTemplateId.value,
      requestController.signal,
    );
    if (currentRequest === requestNumber) {
      preflight.value = result;
      acknowledged.value = false;
    }
  } catch (error) {
    if (
      currentRequest === requestNumber &&
      !(error instanceof ApiError && error.kind === 'ABORT')
    ) {
      preflightError.value =
        error instanceof ApiError ? error.message : 'Unable to complete Manual Run preflight.';
    }
  } finally {
    if (currentRequest === requestNumber) preflightLoading.value = false;
  }
}

function reviewStart(): void {
  if (preflight.value?.canRun !== true || !acknowledged.value || submitting.value) return;
  confirmationOpen.value = true;
}

function closeConfirmation(): void {
  if (submitting.value) return;
  confirmationOpen.value = false;
}

async function startManualRun(): Promise<void> {
  const reviewed = preflight.value;
  if (
    reviewed?.canRun !== true ||
    !acknowledged.value ||
    submitting.value ||
    requestUncertain.value ||
    accepted.value !== null
  ) {
    return;
  }
  submitting.value = true;
  preflightError.value = '';
  try {
    accepted.value = await app.api.startManualRun(workspace.accountId.value, {
      templateId: reviewed.templateId,
      acknowledgeRealSend: true,
    });
    confirmationOpen.value = false;
    acknowledged.value = false;
  } catch (error) {
    confirmationOpen.value = false;
    acknowledged.value = false;
    if (error instanceof ApiError && error.kind === 'API') {
      preflightError.value = error.message;
      preflight.value = null;
    } else {
      requestUncertain.value = true;
    }
  } finally {
    submitting.value = false;
  }
}

onBeforeUnmount(cancelPreflight);
</script>

<template>
  <div class="page-stack account-tab-page">
    <header class="account-tab-heading">
      <div>
        <p class="eyebrow">Manual Run</p>
        <h3>Server-authorized execution</h3>
        <p>Preflight is authoritative. This page never bypasses server gates or idempotency.</p>
      </div>
    </header>

    <section class="manual-run-safety" aria-labelledby="manual-run-safety-title">
      <div>
        <p class="eyebrow">Real external side effect</p>
        <h3 id="manual-run-safety-title">A Manual Run may send real messages</h3>
        <p>
          Select a template to ask the server whether this account can run. No run starts until you
          acknowledge the effect and confirm the final action.
        </p>
      </div>
      <StatusBadge status="WARN" label="Confirmation required" />
    </section>

    <BackgroundRefreshIndicator v-if="templates.refreshing.value" />
    <StaleDataNotice
      v-if="templates.refreshError.value"
      :message="templates.refreshError.value.message"
      @retry="templates.load"
    />

    <SectionLoading
      v-if="templates.loading.value && templates.data.value === null"
      label="Loading templates…"
    />
    <section v-else-if="templates.initialError.value" class="section-error-stack">
      <InlineError :message="templates.initialError.value.message" />
      <button class="button button--secondary" type="button" @click="templates.load">Retry</button>
    </section>
    <EmptyState
      v-else-if="templates.data.value?.length === 0"
      title="No templates configured"
      description="Configure a template before requesting Manual Run preflight."
    >
      <template #action>
        <RouterLink class="button button--secondary" to="/templates">Manage templates</RouterLink>
      </template>
    </EmptyState>
    <template v-else>
      <FormField
        label="Template"
        help-text="Disabled templates remain visible; server preflight decides whether the selection can run."
      >
        <template #default="{ fieldId, describedBy }">
          <select
            :id="fieldId"
            v-model="selectedTemplateId"
            name="manualRunTemplate"
            :aria-describedby="describedBy"
            :disabled="submitting || requestUncertain || accepted !== null"
            @change="chooseTemplate"
          >
            <option value="">Select a template</option>
            <option
              v-for="template in templates.data.value ?? []"
              :key="template.id"
              :value="template.id"
            >
              {{ template.name }}{{ template.enabled ? '' : ' — Disabled' }}
            </option>
          </select>
        </template>
      </FormField>

      <SectionLoading v-if="preflightLoading" label="Checking Manual Run preflight…" />
      <InlineError v-if="preflightError" :message="preflightError" />

      <section v-if="requestUncertain" class="manual-result manual-result--uncertain" role="alert">
        <p class="eyebrow">Manual Run request</p>
        <h3>Request result is uncertain.</h3>
        <p>Do not retry automatically.</p>
        <p>Check Runs to confirm whether a run was accepted.</p>
        <RouterLink class="button button--secondary" to="/runs">View Runs</RouterLink>
      </section>

      <section v-else-if="accepted" class="manual-result manual-result--accepted" role="status">
        <p class="eyebrow">202 Accepted</p>
        <h3>Run accepted</h3>
        <p>The background task is now managed by the server. Acceptance does not prove delivery.</p>
        <RouterLink class="button button--primary" :to="`/runs/${accepted.runId}`">
          View live run
        </RouterLink>
      </section>

      <ManualRunPreflight
        v-else-if="preflight"
        v-model:acknowledged="acknowledged"
        :preflight="preflight"
        :account-name="workspace.account.data.value?.name ?? 'Account'"
        :template-name="selectedTemplate?.name ?? 'Selected template'"
        @start="reviewStart"
      />
    </template>

    <DangerConfirmation
      :open="confirmationOpen"
      title="Start Manual Run?"
      description="This action may send real messages. Confirm the reviewed account, template, and enabled friend count before starting."
      :confirm-label="submitting ? 'Starting…' : 'Start Manual Run'"
      cancel-label="Cancel"
      :pending="submitting"
      @close="closeConfirmation"
      @confirm="startManualRun"
    >
      <dl v-if="preflight" class="confirmation-summary">
        <div>
          <dt>Account</dt>
          <dd>{{ workspace.account.data.value?.name ?? 'Account' }}</dd>
        </div>
        <div>
          <dt>Template</dt>
          <dd>{{ selectedTemplate?.name ?? 'Selected template' }}</dd>
        </div>
        <div>
          <dt>Enabled friends</dt>
          <dd>{{ preflight.enabledFriendCount }}</dd>
        </div>
      </dl>
    </DangerConfirmation>
  </div>
</template>

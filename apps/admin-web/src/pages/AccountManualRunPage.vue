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
import { useTranslation } from '../i18n';
import type { ManualRunAccepted, ManualRunPreflight as ManualRunPreflightDto } from '../types/api';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const { t } = useTranslation();
const templates = useRequest((signal) => app.api.listTemplates(signal));
const selectedTemplateId = ref('');
const preflight = ref<ManualRunPreflightDto | null>(null);
const preflightLoading = ref(false);
const preflightError = ref<ApiError | string>('');
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
        error instanceof ApiError ? error : t('manualRunPage.preflightGenericError');
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
      preflightError.value = error;
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
        <p class="eyebrow">{{ t('manualRunPage.eyebrow') }}</p>
        <h3>{{ t('manualRunPage.title') }}</h3>
        <p>{{ t('manualRunPage.subtitle') }}</p>
      </div>
    </header>

    <section class="manual-run-safety" aria-labelledby="manual-run-safety-title">
      <div>
        <p class="eyebrow">{{ t('manualRunPage.safetyEyebrow') }}</p>
        <h3 id="manual-run-safety-title">{{ t('manualRunPage.safetyTitle') }}</h3>
        <p>
          {{ t('manualRunPage.safetyDescription') }}
        </p>
      </div>
      <StatusBadge status="WARN" :label="t('manualRunPage.confirmationRequired')" />
    </section>

    <BackgroundRefreshIndicator v-if="templates.refreshing.value" />
    <StaleDataNotice
      v-if="templates.refreshError.value"
      :error="templates.refreshError.value"
      @retry="templates.load"
    />

    <SectionLoading
      v-if="templates.loading.value && templates.data.value === null"
      :label="t('manualRunPage.templatesLoading')"
    />
    <section v-else-if="templates.initialError.value" class="section-error-stack">
      <InlineError :error="templates.initialError.value" />
      <button class="button button--secondary" type="button" @click="templates.load">
        {{ t('common.retry') }}
      </button>
    </section>
    <EmptyState
      v-else-if="templates.data.value?.length === 0"
      :title="t('manualRunPage.templatesEmptyTitle')"
      :description="t('manualRunPage.templatesEmptyDescription')"
    >
      <template #action>
        <RouterLink class="button button--secondary" to="/templates">{{
          t('manualRunPage.manageTemplates')
        }}</RouterLink>
      </template>
    </EmptyState>
    <template v-else>
      <FormField
        :label="t('manualRunPage.templateLabel')"
        :help-text="t('manualRunPage.templateHelp')"
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
            <option value="">{{ t('manualRunPage.selectTemplate') }}</option>
            <option
              v-for="template in templates.data.value ?? []"
              :key="template.id"
              :value="template.id"
            >
              {{ template.name }}{{ template.enabled ? '' : t('manualRunPage.disabledSuffix') }}
            </option>
          </select>
        </template>
      </FormField>

      <SectionLoading v-if="preflightLoading" :label="t('manualRunPage.preflightChecking')" />
      <InlineError v-if="preflightError" :error="preflightError" />

      <section v-if="requestUncertain" class="manual-result manual-result--uncertain" role="alert">
        <p class="eyebrow">{{ t('manualRunPage.uncertainEyebrow') }}</p>
        <h3>{{ t('manualRunPage.uncertainTitle') }}</h3>
        <p>{{ t('manualRunPage.uncertainNoRetry') }}</p>
        <p>{{ t('manualRunPage.uncertainCheckRuns') }}</p>
        <RouterLink class="button button--secondary" to="/runs">{{
          t('manualRunPage.viewRuns')
        }}</RouterLink>
      </section>

      <section v-else-if="accepted" class="manual-result manual-result--accepted" role="status">
        <p class="eyebrow">202 Accepted</p>
        <h3>{{ t('manualRunPage.acceptedTitle') }}</h3>
        <p>{{ t('manualRunPage.acceptedDescription') }}</p>
        <RouterLink class="button button--primary" :to="`/runs/${accepted.runId}`">
          {{ t('manualRunPage.viewLiveRun') }}
        </RouterLink>
      </section>

      <ManualRunPreflight
        v-else-if="preflight"
        v-model:acknowledged="acknowledged"
        :preflight="preflight"
        :account-name="workspace.account.data.value?.name ?? t('manualRunPage.accountFallback')"
        :template-name="selectedTemplate?.name ?? t('manualRunPage.templateFallback')"
        @start="reviewStart"
      />
    </template>

    <DangerConfirmation
      :open="confirmationOpen"
      :title="t('manualRunPage.confirmTitle')"
      :description="t('manualRunPage.confirmDescription')"
      :confirm-label="
        submitting ? t('manualRunPage.confirmStarting') : t('manualRunPage.confirmStart')
      "
      :cancel-label="t('common.cancel')"
      :pending="submitting"
      @close="closeConfirmation"
      @confirm="startManualRun"
    >
      <dl v-if="preflight" class="confirmation-summary">
        <div>
          <dt>{{ t('common.account') }}</dt>
          <dd>{{ workspace.account.data.value?.name ?? t('manualRunPage.accountFallback') }}</dd>
        </div>
        <div>
          <dt>{{ t('manualRunPage.summaryTemplate') }}</dt>
          <dd>{{ selectedTemplate?.name ?? t('manualRunPage.templateFallback') }}</dd>
        </div>
        <div>
          <dt>{{ t('manualRunPage.summaryEnabledFriends') }}</dt>
          <dd>{{ preflight.enabledFriendCount }}</dd>
        </div>
      </dl>
    </DangerConfirmation>
  </div>
</template>

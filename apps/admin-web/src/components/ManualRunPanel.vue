<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';

import { ApiError } from '../api/client';
import { useAdminApp } from '../appContext';
import type {
  Account,
  ManualRunBlockedReason,
  ManualRunPreflight,
  MessageTemplateSummary,
} from '../types/api';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{
  account: Account;
  manualRunEnabled: boolean;
  realSendAuthorizationEnabled: boolean;
}>();
const app = useAdminApp();
const router = useRouter();
const open = ref(false);
const loading = ref(false);
const submitting = ref(false);
const templates = ref<MessageTemplateSummary[]>([]);
const templateId = ref('');
const preflight = ref<ManualRunPreflight | null>(null);
const acknowledged = ref(false);
const requestUncertain = ref(false);
const errorMessage = ref('');
let controller: InstanceType<typeof globalThis.AbortController> | undefined;

const selectedTemplate = computed(() =>
  templates.value.find((template) => template.id === templateId.value),
);
const gateMessage = computed(() => {
  if (!props.manualRunEnabled) return 'Manual Run is disabled by server configuration.';
  if (!props.realSendAuthorizationEnabled) return 'Real send authorization is disabled.';
  return '';
});

async function show(): Promise<void> {
  if (gateMessage.value !== '') return;
  open.value = true;
  loading.value = true;
  errorMessage.value = '';
  templates.value = [];
  templateId.value = '';
  preflight.value = null;
  acknowledged.value = false;
  requestUncertain.value = false;
  controller?.abort();
  controller = new globalThis.AbortController();
  try {
    templates.value = (await app.api.listTemplates(controller.signal)).filter(
      (template) => template.enabled,
    );
  } catch (error) {
    errorMessage.value = safeMessage(error, 'Unable to load message templates.');
  } finally {
    loading.value = false;
  }
}

async function review(): Promise<void> {
  if (templateId.value === '' || requestUncertain.value) {
    errorMessage.value = 'Select an enabled message template.';
    return;
  }
  loading.value = true;
  errorMessage.value = '';
  preflight.value = null;
  controller?.abort();
  controller = new globalThis.AbortController();
  try {
    preflight.value = await app.api.getManualRunPreflight(
      props.account.id,
      templateId.value,
      controller.signal,
    );
  } catch (error) {
    errorMessage.value = safeMessage(error, 'Unable to complete Manual Run preflight.');
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  if (
    preflight.value?.canRun !== true ||
    !acknowledged.value ||
    submitting.value ||
    requestUncertain.value
  )
    return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    const accepted = await app.api.startManualRun(props.account.id, {
      templateId: preflight.value.templateId,
      acknowledgeRealSend: true,
    });
    close(true);
    await router.push({ path: `/runs/${accepted.runId}`, query: { accepted: 'manual-run' } });
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'NETWORK') {
      requestUncertain.value = true;
      acknowledged.value = false;
      errorMessage.value = 'Run request status is uncertain. Check Runs before trying again.';
    } else {
      errorMessage.value = safeMessage(error, 'Manual Run could not be accepted.');
    }
  } finally {
    submitting.value = false;
  }
}

function close(force = false): void {
  if (submitting.value && !force) return;
  controller?.abort();
  controller = undefined;
  open.value = false;
  preflight.value = null;
  acknowledged.value = false;
  requestUncertain.value = false;
  errorMessage.value = '';
}

function blockedReasonLabel(reason: ManualRunBlockedReason): string {
  const labels: Record<ManualRunBlockedReason, string> = {
    MANUAL_RUN_DISABLED: 'Manual Run is disabled by server policy.',
    REAL_SEND_NOT_AUTHORIZED: 'Real send authorization is disabled.',
    ACCOUNT_DISABLED: 'The Account is disabled.',
    TEMPLATE_DISABLED: 'The selected template is disabled.',
    NO_ENABLED_FRIENDS: 'No enabled contacts are configured.',
    SCHEDULE_NOT_CONFIGURED: 'A Schedule with a valid business timezone is required.',
    RUN_IN_PROGRESS: 'A run is already in progress for this BusinessDate.',
    RUN_ALREADY_COMPLETE: 'This BusinessDate is already complete; successful sends cannot repeat.',
    RUN_TERMINAL: 'This BusinessDate has a terminal run state and cannot be reset here.',
  };
  return labels[reason];
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <div class="manual-run-entry">
    <button
      class="button button--danger"
      type="button"
      :disabled="gateMessage !== ''"
      aria-haspopup="dialog"
      @click="show"
    >
      Manual Run
    </button>
    <small v-if="gateMessage" class="field-hint">{{ gateMessage }}</small>
  </div>

  <div v-if="open" class="modal-backdrop" role="presentation">
    <section
      class="modal-card page-stack"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-run-title"
    >
      <header class="card__header">
        <div>
          <p class="eyebrow">Real external side effect</p>
          <h3 id="manual-run-title">Manual Run</h3>
          <p>Runs the current BusinessDate through the existing DailyTaskRunner.</p>
        </div>
        <button
          class="button button--secondary"
          type="button"
          :disabled="submitting"
          @click="close()"
        >
          Cancel
        </button>
      </header>
      <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
      <RouterLink v-if="requestUncertain" class="button button--secondary" to="/runs">
        Check Runs
      </RouterLink>
      <p v-if="loading" role="status">Loading safe preflight…</p>
      <label class="field-stack" for="manual-template">
        <span>Enabled message template</span>
        <select
          id="manual-template"
          v-model="templateId"
          :disabled="loading || submitting || requestUncertain"
          @change="
            preflight = null;
            acknowledged = false;
          "
        >
          <option value="">Select a template</option>
          <option v-for="template in templates" :key="template.id" :value="template.id">
            {{ template.name }}
          </option>
        </select>
      </label>
      <p v-if="!loading && templates.length === 0" class="empty-inline">
        No enabled message templates are available.
      </p>
      <button
        class="button button--secondary"
        type="button"
        :disabled="loading || submitting || requestUncertain || templateId === ''"
        @click="review"
      >
        Review preflight
      </button>
      <template v-if="preflight">
        <dl class="definition-grid">
          <div>
            <dt>Account</dt>
            <dd>{{ account.name }}</dd>
          </div>
          <div>
            <dt>Template</dt>
            <dd>{{ selectedTemplate?.name ?? 'Selected template' }}</dd>
          </div>
          <div>
            <dt>BusinessDate</dt>
            <dd>{{ preflight.businessDate ?? 'Unavailable' }}</dd>
          </div>
          <div>
            <dt>Enabled contacts</dt>
            <dd>{{ preflight.enabledFriendCount }}</dd>
          </div>
          <div>
            <dt>Current DailyRun</dt>
            <dd><StatusBadge :status="preflight.currentDailyRunStatus ?? 'NOT_STARTED'" /></dd>
          </div>
          <div>
            <dt>Pending contacts</dt>
            <dd>{{ preflight.pendingFriendCount }}</dd>
          </div>
          <div>
            <dt>Manual Run gate</dt>
            <dd><StatusBadge :status="preflight.manualRunEnabled ? 'ENABLED' : 'DISABLED'" /></dd>
          </div>
          <div>
            <dt>Real send authorization</dt>
            <dd>
              <StatusBadge
                :status="preflight.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'"
              />
            </dd>
          </div>
        </dl>
        <ul v-if="preflight.blockedReasons.length > 0" class="warning-list" role="alert">
          <li v-for="reason in preflight.blockedReasons" :key="reason">
            {{ blockedReasonLabel(reason) }}
          </li>
        </ul>
        <label v-if="preflight.canRun" class="confirmation-row">
          <input v-model="acknowledged" type="checkbox" :disabled="submitting" />
          <span
            >This action may send real messages to all configured enabled contacts for the current
            BusinessDate.</span
          >
        </label>
        <button
          class="button button--danger"
          type="button"
          :disabled="!preflight.canRun || !acknowledged || submitting || requestUncertain"
          @click="submit"
        >
          {{ submitting ? 'Accepting run…' : 'Accept Manual Run' }}
        </button>
        <small>202 Accepted means execution started; it does not mean delivery succeeded.</small>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { TestSendPreview } from '@sparkkeeper/shared';
import { useAdminApp } from '../appContext';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { createContactsApi } from '../api/contactApi';
import { createTestSendApi } from '../api/testSendApi';
import { ApiError } from '../api/client';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { useApiErrorText } from '../composables/useApiErrorText';
const app = useAdminApp(),
  workspace = useAccountWorkspace();
const { t } = useTranslation(),
  { apiErrorText } = useApiErrorText();
const options = {
  csrfTokenProvider: app.auth.getCsrfToken,
  onUnauthenticated: () => app.auth.handleSessionLoss(),
};
const api = createTestSendApi(options),
  contactsApi = createContactsApi(options);
const contacts = useRequest((signal) =>
  contactsApi.list(
    workspace.accountId.value,
    { availability: 'AVAILABLE', identityStatus: 'READY' },
    signal,
  ),
);
const templates = useRequest((signal) => app.api.listTemplates(signal));
const contactId = ref(''),
  templateId = ref(''),
  preview = ref<TestSendPreview | null>(null),
  confirmed = ref(false),
  busy = ref(false),
  uncertain = ref(false),
  runId = ref(''),
  error = ref<ApiError | string>('');
const detail = useRequest((signal) => api.detail(runId.value, signal), { immediate: false });
const eligibleContacts = computed(
  () => contacts.data.value?.items.filter((c) => c.type === 'PERSON' || c.type === 'GROUP') ?? [],
);
const enabledTemplates = computed(() => templates.data.value?.filter((v) => v.enabled) ?? []);
let key = '',
  generation = 0,
  controller: InstanceType<typeof globalThis.AbortController> | undefined;
function reset() {
  generation++;
  controller?.abort();
  preview.value = null;
  confirmed.value = false;
  uncertain.value = false;
  busy.value = false;
  runId.value = '';
  error.value = '';
  key = '';
  detail.reset();
}
watch([contactId, templateId], () => {
  if (!uncertain.value) reset();
});
watch(workspace.accountId, () => {
  reset();
  contactId.value = '';
  templateId.value = '';
  contacts.reset();
  templates.reset();
  void contacts.load();
  void templates.load();
});
watch(
  () => app.auth.state.value,
  () => {
    if (!app.auth.isAuthenticated()) reset();
  },
);
onBeforeUnmount(() => {
  reset();
  contacts.cancel();
  templates.cancel();
  detail.cancel();
});
async function makePreview() {
  if (busy.value || uncertain.value || !contactId.value || !templateId.value) return;
  const epoch = ++generation;
  controller = new globalThis.AbortController();
  busy.value = true;
  error.value = '';
  preview.value = null;
  confirmed.value = false;
  try {
    const value = await api.preview(
      workspace.accountId.value,
      templateId.value,
      contactId.value,
      globalThis.crypto.randomUUID(),
      controller.signal,
    );
    if (epoch === generation) {
      preview.value = value;
      key = globalThis.crypto.randomUUID();
    }
  } catch (e) {
    if (epoch === generation) error.value = e instanceof ApiError ? e : t('testSend.error');
  } finally {
    if (epoch === generation) busy.value = false;
  }
}
async function execute(reconcile = false) {
  if (
    busy.value ||
    !preview.value ||
    (!reconcile &&
      (!confirmed.value || uncertain.value || Date.now() >= Date.parse(preview.value.expiresAt)))
  )
    return;
  const epoch = generation;
  controller = new globalThis.AbortController();
  busy.value = true;
  error.value = '';
  try {
    const accepted = await api.confirm(
      workspace.accountId.value,
      preview.value,
      key,
      controller.signal,
    );
    if (epoch !== generation) return;
    uncertain.value = false;
    runId.value = accepted.runId;
    preview.value = null;
    confirmed.value = false;
    await detail.load();
  } catch (e) {
    if (epoch !== generation) return;
    error.value = e instanceof ApiError ? e : t('testSend.error');
    uncertain.value =
      !(e instanceof ApiError) ||
      e.kind !== 'API' ||
      (e.httpStatus >= 500 && !['RELEASE_GATE_CLOSED', 'RUNTIME_UNAVAILABLE'].includes(e.code));
  } finally {
    if (epoch === generation) busy.value = false;
  }
}
</script>
<template>
  <section class="page-stack">
    <h2>{{ t('testSend.title') }}</h2>
    <p>{{ t('testSend.scope') }}</p>
    <label
      >{{ t('testSend.contact')
      }}<select v-model="contactId" :disabled="busy || uncertain">
        <option value="">—</option>
        <option v-for="c in eligibleContacts" :key="c.id" :value="c.id">
          {{ c.displayName }} · {{ c.type }} · {{ c.id.slice(-8) }}
        </option>
      </select></label
    >
    <label
      >{{ t('testSend.template')
      }}<select v-model="templateId" :disabled="busy || uncertain">
        <option value="">—</option>
        <option v-for="v in enabledTemplates" :key="v.id" :value="v.id">
          {{ v.name }} · {{ v.providerType }}
        </option>
      </select></label
    >
    <p v-if="contacts.error.value || templates.error.value" role="alert">
      {{ apiErrorText(contacts.error.value ?? templates.error.value) }}
    </p>
    <button
      data-testid="preview"
      class="button"
      :disabled="busy || uncertain || !contactId || !templateId"
      @click="makePreview"
    >
      {{ t('testSend.preview') }}
    </button>
    <section v-if="preview" class="panel">
      <p>
        {{ preview.account.name }} · {{ preview.templateSummary.name }} ·
        {{ preview.orderedTargets[0].displayName }} · {{ preview.orderedTargets[0].type }}
      </p>
      <p>{{ t('testSend.expires') }} {{ preview.expiresAt }}</p>
      <label
        ><input v-model="confirmed" type="checkbox" :disabled="busy || uncertain" />{{
          t('testSend.confirmation')
        }}</label
      >
      <button
        data-testid="confirm"
        class="button"
        :disabled="busy || uncertain || !confirmed"
        @click="execute()"
      >
        {{ t('testSend.confirm') }}
      </button>
    </section>
    <p v-if="error" role="alert">{{ apiErrorText(error) }}</p>
    <template v-if="uncertain"
      ><p>{{ t('testSend.uncertain') }}</p>
      <button data-testid="reconcile" :disabled="busy" @click="execute(true)">
        {{ t('testSend.reconcile') }}
      </button></template
    >
    <RouterLink v-if="runId" :to="`/test-sends/${runId}`">{{ t('testSend.detail') }}</RouterLink>
    <p v-if="detail.data.value">
      {{ detail.data.value.status }} · {{ detail.data.value.record.machineStatus }}
    </p>
  </section>
</template>

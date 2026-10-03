<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  CONTACT_TYPES,
  CONTACT_AVAILABILITY_STATUSES,
  CONTACT_IDENTITY_STATUSES,
} from '@sparkkeeper/shared';
import { createContactsApi } from '../api/contactApi';
import { ApiError } from '../api/client';
import { useAdminApp } from '../appContext';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { useApiErrorText } from '../composables/useApiErrorText';
import Drawer from '../components/Drawer.vue';

const app = useAdminApp(),
  workspace = useAccountWorkspace();
const { t } = useTranslation(),
  { apiErrorText } = useApiErrorText();
const api = createContactsApi({
  csrfTokenProvider: app.auth.getCsrfToken,
  onUnauthenticated: () => app.auth.handleSessionLoss(),
});
const query = ref(''),
  type = ref(''),
  availability = ref(''),
  identity = ref(''),
  cursor = ref('');
const syncId = ref(''),
  detailId = ref(''),
  submitting = ref(false),
  uncertainKey = ref<string | null>(null),
  startError = ref<ApiError | null>(null);
const filters = computed(() =>
  Object.fromEntries(
    Object.entries({
      query: query.value,
      type: type.value,
      availability: availability.value,
      identityStatus: identity.value,
      cursor: cursor.value,
    }).filter(([, v]) => v !== ''),
  ),
);
const contacts = useRequest((signal) => api.list(workspace.accountId.value, filters.value, signal));
const sync = useRequest((signal) => api.status(syncId.value, signal), { immediate: false });
const activeLogin = useRequest((signal) => app.api.getActiveAccountLogin(signal));
const detail = useRequest((signal) => api.detail(detailId.value, signal), { immediate: false });
const running = computed(() =>
  ['PENDING', 'RUNNING'].includes(
    sync.data.value?.status ?? contacts.data.value?.latestSync?.status ?? '',
  ),
);
const eligible = computed(
  () =>
    workspace.account.data.value?.loginStatus === 'READY' &&
    workspace.account.data.value?.profileState === 'READY' &&
    workspace.account.data.value?.lifecycleStatus === 'ACTIVE',
);
const knownFlow = computed(() => running.value || Boolean(activeLogin.data.value?.session));
const canStart = computed(
  () => eligible.value && !knownFlow.value && !submitting.value && app.auth.isAuthenticated(),
);
let mounted = true;
let timer: ReturnType<typeof globalThis.setInterval> | undefined;
let startController: InstanceType<typeof globalThis.AbortController> | undefined;
onMounted(() => {
  timer = globalThis.setInterval(() => {
    if (mounted && app.auth.isAuthenticated() && running.value && !sync.loading.value)
      void sync.load();
  }, 2000);
});
function stopReads() {
  contacts.cancel();
  sync.cancel();
  detail.cancel();
  activeLogin.cancel();
  startController?.abort();
}
onBeforeUnmount(() => {
  mounted = false;
  if (timer !== undefined) globalThis.clearInterval(timer);
  stopReads();
});
watch(app.auth.state, (state) => {
  if (state !== 'AUTHENTICATED') {
    stopReads();
    contacts.reset();
    sync.reset();
    detail.reset();
    activeLogin.reset();
  }
});
watch(
  () => contacts.data.value?.latestSync,
  (latest) => {
    if (latest && (!syncId.value || !running.value)) {
      syncId.value = latest.id;
      sync.data.value = latest;
    }
  },
);
watch(
  () => sync.data.value?.status,
  (status, old) => {
    if (
      status &&
      !['PENDING', 'RUNNING'].includes(status) &&
      ['PENDING', 'RUNNING'].includes(old ?? '')
    ) {
      cursor.value = '';
      void contacts.load();
      void workspace.account.load();
    }
  },
);
watch(workspace.accountId, () => {
  stopReads();
  contacts.reset();
  sync.reset();
  detail.reset();
  syncId.value = '';
  detailId.value = '';
  cursor.value = '';
  uncertainKey.value = null;
  submitting.value = false;
  startError.value = null;
  void contacts.load();
  void activeLogin.load();
});
watch([type, availability, identity], () => {
  cursor.value = '';
  void contacts.load();
});
function search() {
  cursor.value = '';
  void contacts.load();
}
function next() {
  cursor.value = contacts.data.value?.nextCursor ?? '';
  void contacts.load();
}
function openDetail(id: string) {
  detail.reset();
  detailId.value = id;
  void detail.load();
}
async function start() {
  if (!canStart.value) return;
  submitting.value = true;
  startError.value = null;
  const accountId = workspace.accountId.value;
  const key = uncertainKey.value ?? globalThis.crypto.randomUUID();
  startController = new globalThis.AbortController();
  try {
    const result = await api.start(accountId, key, startController.signal);
    if (!mounted || workspace.accountId.value !== accountId || !app.auth.isAuthenticated()) return;
    uncertainKey.value = null;
    syncId.value = result.syncRunId;
    await sync.load();
    await contacts.load();
  } catch (e) {
    if (!mounted || workspace.accountId.value !== accountId || !app.auth.isAuthenticated()) return;
    startError.value =
      e instanceof ApiError
        ? e
        : new ApiError('UNEXPECTED_ERROR', t('common.unexpectedError'), 0, 'MALFORMED');
    if (startError.value.kind === 'NETWORK') uncertainKey.value = key;
    else if (startError.value.kind !== 'ABORT') uncertainKey.value = null;
    await contacts.load();
    await activeLogin.load();
  } finally {
    if (mounted && workspace.accountId.value === accountId) submitting.value = false;
  }
}
</script>
<template>
  <section class="page-stack">
    <header class="page-heading">
      <div>
        <h2>{{ t('contacts.title') }}</h2>
        <p>{{ t('contacts.scope') }}</p>
      </div>
      <button
        class="button button--primary"
        data-testid="sync"
        :disabled="!canStart"
        @click="start"
      >
        {{ t(uncertainKey ? 'contacts.reconcile' : 'contacts.sync') }}
      </button>
    </header>
    <p v-if="startError" role="alert">{{ apiErrorText(startError) }}</p>
    <p v-if="uncertainKey" role="status">{{ t('contacts.uncertain') }}</p>
    <p v-if="knownFlow">{{ t('contacts.busy') }}</p>
    <RouterLink v-if="!eligible" :to="`/accounts/${workspace.accountId.value}/overview`">{{
      t('accountLogin.relogin')
    }}</RouterLink>
    <div v-if="sync.data.value" aria-live="polite">
      <p>
        {{ t(`contacts.status.${sync.data.value.status}`) }} ·
        {{ sync.data.value.candidateCount }} / {{ sync.data.value.issueCount }}
      </p>
      <p v-if="sync.data.value.failureCode">{{ sync.data.value.failureCode }}</p>
      <p v-if="sync.data.value.status === 'PARTIAL'">{{ t('contacts.partial') }}</p>
    </div>
    <form class="page-actions" @submit.prevent="search">
      <input v-model="query" :aria-label="t('contacts.search')" maxlength="100" /><select
        v-model="type"
        :aria-label="t('contacts.type')"
      >
        <option value="">{{ t('contacts.all') }}</option>
        <option v-for="v in CONTACT_TYPES" :key="v" :value="v">{{ v }}</option></select
      ><select v-model="availability" :aria-label="t('contacts.availability')">
        <option value="">{{ t('contacts.all') }}</option>
        <option v-for="v in CONTACT_AVAILABILITY_STATUSES" :key="v" :value="v">
          {{ v }}
        </option></select
      ><select v-model="identity" :aria-label="t('contacts.identity')">
        <option value="">{{ t('contacts.all') }}</option>
        <option v-for="v in CONTACT_IDENTITY_STATUSES" :key="v" :value="v">{{ v }}</option></select
      ><button class="button button--secondary" type="submit">{{ t('contacts.search') }}</button>
    </form>
    <p v-if="contacts.loading.value">{{ t('common.loadingData') }}</p>
    <p v-if="contacts.error.value" role="alert">{{ apiErrorText(contacts.error.value) }}</p>
    <p v-if="contacts.data.value?.items.length === 0">{{ t('contacts.empty') }}</p>
    <div v-if="contacts.data.value?.items.length" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('contacts.name') }}</th>
            <th>{{ t('contacts.type') }}</th>
            <th>{{ t('contacts.availability') }}</th>
            <th>{{ t('contacts.identity') }}</th>
            <th>{{ t('contacts.streak') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contact in contacts.data.value.items" :key="contact.id">
            <td>
              <span aria-hidden="true">○</span
              ><img
                v-if="contact.avatarAssetId"
                width="32"
                height="32"
                alt=""
                :src="`/api/avatar-assets/${encodeURIComponent(contact.avatarAssetId)}`"
                @error="($event.target as HTMLImageElement).hidden = true"
              /><button class="button button--secondary" @click="openDetail(contact.id)">
                {{ contact.displayName }}</button
              ><span>{{ contact.remarkName }}</span>
            </td>
            <td>{{ contact.type }}</td>
            <td>{{ contact.availabilityStatus }}</td>
            <td>{{ contact.identityStatus }}</td>
            <td>{{ contact.streakDays ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="page-actions">
      <button class="button button--secondary" @click="search">{{ t('common.refresh') }}</button
      ><button
        class="button button--secondary"
        :disabled="!contacts.data.value?.nextCursor"
        @click="next"
      >
        {{ t('contacts.next') }}
      </button>
    </div>
    <Drawer :open="Boolean(detailId)" :title="t('contacts.detail')" @close="detailId = ''">
      <p v-if="detail.error.value" role="alert">{{ apiErrorText(detail.error.value) }}</p>
      <div v-if="detail.data.value">
        <h3>{{ detail.data.value.displayName }}</h3>
        <p>{{ detail.data.value.identityStatus }} · {{ detail.data.value.availabilityStatus }}</p>
        <p>{{ t('contacts.notSendPermission') }}</p>
        <ul>
          <li v-for="i in detail.data.value.identities" :key="i.id">
            {{ i.kind }}: {{ i.maskedValue }} · {{ i.state }}
          </li>
        </ul>
      </div>
    </Drawer>
  </section>
</template>

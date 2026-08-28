<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { invalidatesWorkspaceAccount } from '../api/accountWorkspaceInvalidation';
import { ApiError } from '../api/client';
import { accountWorkspaceContextKey } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import AccountForm from '../components/AccountForm.vue';
import AuthStatusBadge from '../components/AuthStatusBadge.vue';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import DangerConfirmation from '../components/DangerConfirmation.vue';
import Drawer from '../components/Drawer.vue';
import PageError from '../components/PageError.vue';
import Skeleton from '../components/Skeleton.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useApiErrorText } from '../composables/useApiErrorText';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import { useTranslation } from '../i18n';
import type { CreateAccountInput } from '../types/api';

const app = useAdminApp();
const route = useRoute();
const toasts = useToasts();
const { t } = useTranslation();
const { apiErrorText } = useApiErrorText();
const accountId = computed(() => String(route.params.accountId));
const account = useRequest((signal) => app.api.getAccount(accountId.value, signal));
const settingsOpen = ref(false);
const submitting = ref(false);
// ApiError snapshot localized at render time; string keeps the generic copy.
const formError = ref<ApiError | string>('');
const formDirty = ref(false);
const serverChanged = ref(false);
const reloadConfirmationOpen = ref(false);

provide(accountWorkspaceContextKey, { accountId, account });

watch(accountId, () => {
  settingsOpen.value = false;
  formDirty.value = false;
  serverChanged.value = false;
  account.reset();
  void account.load();
});
watch(app.refreshVersion, () => void refreshAccount());
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesWorkspaceAccount(event, accountId.value),
  () => void refreshAccount(),
);

const tabs = computed(() => [
  { labelKey: 'nav.overview', path: `/accounts/${accountId.value}/overview` },
  { labelKey: 'account.friendsTab', path: `/accounts/${accountId.value}/friends` },
  { labelKey: 'account.scheduleTab', path: `/accounts/${accountId.value}/schedule` },
  { labelKey: 'account.manualRunTab', path: `/accounts/${accountId.value}/manual-run` },
  { labelKey: 'account.historyTab', path: `/accounts/${accountId.value}/history` },
]);

function openSettings(): void {
  formError.value = '';
  formDirty.value = false;
  serverChanged.value = false;
  settingsOpen.value = true;
}

function closeSettings(): void {
  if (submitting.value) return;
  settingsOpen.value = false;
  formError.value = '';
  formDirty.value = false;
  serverChanged.value = false;
  reloadConfirmationOpen.value = false;
}

async function refreshAccount(force = false): Promise<void> {
  if (!force && settingsOpen.value && formDirty.value) {
    serverChanged.value = true;
    return;
  }
  await account.load();
}

function requestServerReload(): void {
  if (formDirty.value) reloadConfirmationOpen.value = true;
  else void refreshAccount(true);
}

async function confirmServerReload(): Promise<void> {
  reloadConfirmationOpen.value = false;
  await refreshAccount(true);
  if (account.error.value === null) serverChanged.value = false;
}

async function saveAccount(input: CreateAccountInput): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  formError.value = '';
  try {
    await app.api.updateAccount(accountId.value, input);
    await refreshAccount(true);
    settingsOpen.value = false;
    toasts.notify('success', t('account.savedToast'));
  } catch (error) {
    formError.value = error instanceof ApiError ? error : t('account.saveErrorToast');
    toasts.notify('error', t('account.saveErrorToast'));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page-stack account-workspace">
    <RouterLink class="account-workspace__back" to="/accounts">{{
      t('account.backToAccounts')
    }}</RouterLink>

    <header class="account-workspace__header">
      <div
        v-if="account.loading.value && account.data.value === null"
        class="account-header-loading"
      >
        <Skeleton width="240px" height="30px" :label="t('account.headerLoading')" />
        <Skeleton width="180px" />
      </div>
      <template v-else-if="account.data.value">
        <div>
          <p class="eyebrow">{{ t('account.workspaceEyebrow') }}</p>
          <h2>{{ account.data.value.name }}</h2>
          <div class="account-workspace__statuses" :aria-label="t('account.statusAria')">
            <AuthStatusBadge :status="account.data.value.loginStatus" />
            <StatusBadge :status="account.data.value.enabled ? 'ENABLED' : 'DISABLED'" />
          </div>
        </div>
        <button class="button button--secondary" type="button" @click="openSettings">
          {{ t('account.settings') }}
        </button>
      </template>
      <div v-else>
        <p class="eyebrow">{{ t('account.workspaceEyebrow') }}</p>
        <h2>{{ t('account.unavailableTitle') }}</h2>
      </div>
    </header>

    <BackgroundRefreshIndicator v-if="account.refreshing.value" />
    <StaleDataNotice
      v-if="account.refreshError.value"
      :error="account.refreshError.value"
      @retry="refreshAccount(true)"
    />

    <nav
      v-if="account.initialError.value === null"
      class="account-tabs"
      :aria-label="t('account.workspaceEyebrow')"
    >
      <RouterLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="account-tabs__link"
        exact-active-class="account-tabs__link--active"
      >
        {{ t(tab.labelKey) }}
      </RouterLink>
    </nav>

    <PageError
      v-if="account.initialError.value"
      :title="
        account.initialError.value.httpStatus === 404
          ? t('account.notFoundTitle')
          : t('account.errorTitle')
      "
      :message="
        account.initialError.value.httpStatus === 404
          ? t('account.notFoundMessage')
          : apiErrorText(account.initialError.value)
      "
      @retry="account.load"
    />
    <RouterLink v-if="account.initialError.value" class="button button--secondary" to="/accounts">
      {{ t('account.backToList') }}
    </RouterLink>
    <RouterView v-else-if="account.data.value" />

    <Drawer :open="settingsOpen" :title="t('account.settings')" @close="closeSettings">
      <p class="drawer-intro">{{ t('account.settingsIntro') }}</p>
      <p class="form-note">{{ t('account.loginStatusNote') }}</p>
      <section v-if="serverChanged" class="notification-server-change" role="status">
        <div>
          <strong>{{ t('account.serverChangedTitle') }}</strong>
          <span>{{ t('account.serverChangedBody') }}</span>
        </div>
        <button
          class="button button--secondary button--compact"
          type="button"
          @click="requestServerReload"
        >
          {{ t('account.reload') }}
        </button>
      </section>
      <AccountForm
        v-if="account.data.value"
        :account="account.data.value"
        :submitting="submitting"
        :server-error="apiErrorText(formError)"
        @submit="saveAccount"
        @cancel="closeSettings"
        @dirty-change="formDirty = $event"
      />
    </Drawer>

    <DangerConfirmation
      :open="reloadConfirmationOpen"
      :title="t('account.reloadConfirmTitle')"
      :description="t('account.reloadConfirmDescription')"
      :confirm-label="t('account.reloadConfirmButton')"
      :cancel-label="t('account.keepEditing')"
      @close="reloadConfirmationOpen = false"
      @confirm="confirmServerReload"
    />
  </div>
</template>

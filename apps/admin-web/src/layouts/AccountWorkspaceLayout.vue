<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { invalidatesWorkspaceAccount } from '../api/accountWorkspaceInvalidation';
import { ApiError } from '../api/client';
import { accountWorkspaceContextKey } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import AccountForm from '../components/AccountForm.vue';
import AuthStatusBadge from '../components/AuthStatusBadge.vue';
import Drawer from '../components/Drawer.vue';
import PageError from '../components/PageError.vue';
import Skeleton from '../components/Skeleton.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import type { CreateAccountInput } from '../types/api';

const app = useAdminApp();
const route = useRoute();
const toasts = useToasts();
const accountId = computed(() => String(route.params.accountId));
const account = useRequest((signal) => app.api.getAccount(accountId.value, signal));
const settingsOpen = ref(false);
const submitting = ref(false);
const formError = ref('');

provide(accountWorkspaceContextKey, { accountId, account });

watch(accountId, () => void account.load());
watch(app.refreshVersion, () => void account.load());
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesWorkspaceAccount(event, accountId.value),
  () => void account.load(),
);

const tabs = computed(() => [
  { label: 'Overview', path: `/accounts/${accountId.value}/overview` },
  { label: 'Friends', path: `/accounts/${accountId.value}/friends` },
  { label: 'Schedule', path: `/accounts/${accountId.value}/schedule` },
  { label: 'Manual Run', path: `/accounts/${accountId.value}/manual-run` },
  { label: 'History', path: `/accounts/${accountId.value}/history` },
]);

function openSettings(): void {
  formError.value = '';
  settingsOpen.value = true;
}

function closeSettings(): void {
  if (submitting.value) return;
  settingsOpen.value = false;
  formError.value = '';
}

async function saveAccount(input: CreateAccountInput): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  formError.value = '';
  try {
    await app.api.updateAccount(accountId.value, input);
    await account.load();
    settingsOpen.value = false;
    toasts.notify('success', 'Account settings saved.');
  } catch (error) {
    formError.value =
      error instanceof ApiError ? error.message : 'Account settings could not be saved.';
    toasts.notify('error', 'Account settings could not be saved.');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page-stack account-workspace">
    <RouterLink class="account-workspace__back" to="/accounts">← Accounts</RouterLink>

    <header class="account-workspace__header">
      <div
        v-if="account.loading.value && account.data.value === null"
        class="account-header-loading"
      >
        <Skeleton width="240px" height="30px" label="Loading account header…" />
        <Skeleton width="180px" />
      </div>
      <template v-else-if="account.data.value">
        <div>
          <p class="eyebrow">Account workspace</p>
          <h2>{{ account.data.value.name }}</h2>
          <div class="account-workspace__statuses" aria-label="Account status">
            <AuthStatusBadge :status="account.data.value.loginStatus" />
            <StatusBadge :status="account.data.value.enabled ? 'ENABLED' : 'DISABLED'" />
          </div>
        </div>
        <button class="button button--secondary" type="button" @click="openSettings">
          Account settings
        </button>
      </template>
      <div v-else>
        <p class="eyebrow">Account workspace</p>
        <h2>Account unavailable</h2>
      </div>
    </header>

    <nav v-if="account.error.value === null" class="account-tabs" aria-label="Account workspace">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="account-tabs__link"
        exact-active-class="account-tabs__link--active"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <PageError
      v-if="account.error.value"
      :title="
        account.error.value.httpStatus === 404 ? 'Account not found' : 'Unable to load account'
      "
      :message="
        account.error.value.httpStatus === 404
          ? 'This account is not available.'
          : account.error.value.message
      "
      @retry="account.load"
    />
    <RouterLink v-if="account.error.value" class="button button--secondary" to="/accounts">
      Back to Accounts
    </RouterLink>
    <RouterView v-else-if="account.data.value" />

    <Drawer :open="settingsOpen" title="Account settings" @close="closeSettings">
      <p class="drawer-intro">Only the account name and enabled state can be changed.</p>
      <p class="form-note">Login status is runtime state and cannot be edited here.</p>
      <AccountForm
        v-if="account.data.value"
        :account="account.data.value"
        :submitting="submitting"
        :server-error="formError"
        @submit="saveAccount"
        @cancel="closeSettings"
      />
    </Drawer>
  </div>
</template>

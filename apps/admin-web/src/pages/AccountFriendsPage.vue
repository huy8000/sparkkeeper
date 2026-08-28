<script setup lang="ts">
import { ref, watch } from 'vue';

import { invalidatesWorkspaceFriends } from '../api/accountWorkspaceInvalidation';
import { ApiError } from '../api/client';
import { useAccountWorkspace } from '../accountWorkspaceContext';
import { useAdminApp } from '../appContext';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import Drawer from '../components/Drawer.vue';
import EmptyState from '../components/EmptyState.vue';
import FriendForm from '../components/FriendForm.vue';
import InlineError from '../components/InlineError.vue';
import RunStatusBadge from '../components/RunStatusBadge.vue';
import SectionLoading from '../components/SectionLoading.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useApiErrorText } from '../composables/useApiErrorText';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import { useTranslation } from '../i18n';
import type { Friend, FriendConfigurationInput } from '../types/api';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const toasts = useToasts();
const { t } = useTranslation();
const { apiErrorText } = useApiErrorText();
const friends = useRequest((signal) => app.api.listFriends(workspace.accountId.value, signal));
const drawerOpen = ref(false);
const editingFriend = ref<Friend | null>(null);
const submitting = ref(false);
const formError = ref<ApiError | string>('');

watch(app.refreshVersion, () => void friends.load());
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesWorkspaceFriends(event, workspace.accountId.value),
  () => void friends.load(),
);

function beginCreate(): void {
  editingFriend.value = null;
  formError.value = '';
  drawerOpen.value = true;
}

function beginEdit(friend: Friend): void {
  editingFriend.value = friend;
  formError.value = '';
  drawerOpen.value = true;
}

function closeDrawer(): void {
  if (submitting.value) return;
  drawerOpen.value = false;
  editingFriend.value = null;
  formError.value = '';
}

async function saveFriend(input: FriendConfigurationInput): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  formError.value = '';
  try {
    if (editingFriend.value === null) {
      await app.api.createFriend(workspace.accountId.value, input);
    } else {
      await app.api.updateFriend(editingFriend.value.id, input);
    }
    await friends.load();
    drawerOpen.value = false;
    editingFriend.value = null;
    toasts.notify('success', t('friendsPage.savedToast'));
  } catch (error) {
    formError.value = error instanceof ApiError ? error : t('friendsPage.saveErrorToast');
    toasts.notify('error', t('friendsPage.saveErrorToast'));
  } finally {
    submitting.value = false;
  }
}

function matchFieldLabel(value: Friend['matchField']): string {
  const labels: Record<Friend['matchField'], string> = {
    secUid: 'friendMatchField.secUid',
    uniqueId: 'friendMatchField.uniqueId',
    shortId: 'friendMatchField.shortId',
    remarkName: 'friendMatchField.remarkName',
    displayName: 'friendMatchField.displayName',
  };
  return t(labels[value]);
}

function identityConfigured(friend: Friend): boolean {
  const value = friend[friend.matchField];
  return value !== null && value.trim().length > 0;
}
</script>

<template>
  <div class="page-stack account-tab-page">
    <header class="account-tab-heading">
      <div>
        <p class="eyebrow">{{ t('friendsPage.eyebrow') }}</p>
        <h3>{{ t('friendsPage.title') }}</h3>
        <p>{{ t('friendsPage.subtitle') }}</p>
      </div>
      <button class="button button--primary" type="button" @click="beginCreate">
        {{ t('friendsPage.add') }}
      </button>
    </header>

    <BackgroundRefreshIndicator v-if="friends.refreshing.value" />
    <StaleDataNotice
      v-if="friends.refreshError.value"
      :error="friends.refreshError.value"
      @retry="friends.load"
    />

    <SectionLoading
      v-if="friends.loading.value && friends.data.value === null"
      :label="t('friendsPage.loading')"
    />
    <section v-else-if="friends.initialError.value" class="section-error-stack">
      <InlineError :error="friends.initialError.value" />
      <button class="button button--secondary" type="button" @click="friends.load">
        {{ t('common.retry') }}
      </button>
    </section>
    <EmptyState
      v-else-if="friends.data.value?.length === 0"
      :title="t('friendsPage.emptyTitle')"
      :description="t('friendsPage.subtitle')"
    >
      <template #action>
        <button class="button button--primary" type="button" @click="beginCreate">
          {{ t('friendsPage.add') }}
        </button>
      </template>
    </EmptyState>
    <div v-else-if="friends.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('friendsPage.columnDisplayName') }}</th>
            <th>{{ t('friendsPage.columnEnabled') }}</th>
            <th>{{ t('friendsPage.columnMatchStrategy') }}</th>
            <th>{{ t('friendsPage.columnIdentity') }}</th>
            <th>{{ t('friendsPage.columnUpdated') }}</th>
            <th>{{ t('friendsPage.columnActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="friend in friends.data.value" :key="friend.id">
            <td>
              <strong>{{ friend.displayName }}</strong>
            </td>
            <td><RunStatusBadge :status="friend.enabled ? 'ENABLED' : 'DISABLED'" /></td>
            <td>
              <span>{{ matchFieldLabel(friend.matchField) }}</span>
              <small v-if="friend.matchField === 'displayName'" class="table-cell-note">
                {{ t('friendStability.low') }}
              </small>
            </td>
            <td>
              {{
                identityConfigured(friend)
                  ? t('friendsPage.identityConfigured')
                  : t('friendsPage.identityMissing')
              }}
            </td>
            <td>{{ formatTimestamp(friend.updatedAt) }}</td>
            <td>
              <button
                class="button button--secondary button--compact"
                type="button"
                @click="beginEdit(friend)"
              >
                {{ t('common.edit') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Drawer
      :open="drawerOpen"
      :title="
        editingFriend === null ? t('friendsPage.drawerAddTitle') : t('friendsPage.drawerEditTitle')
      "
      @close="closeDrawer"
    >
      <p class="drawer-intro">
        {{ t('friendsPage.drawerIntro') }}
      </p>
      <FriendForm
        :friend="editingFriend ?? undefined"
        :submitting="submitting"
        :server-error="apiErrorText(formError)"
        @submit="saveFriend"
        @cancel="closeDrawer"
      />
    </Drawer>
  </div>
</template>

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
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useRequest } from '../composables/useRequest';
import { useToasts } from '../composables/useToasts';
import type { Friend, FriendConfigurationInput } from '../types/api';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const workspace = useAccountWorkspace();
const toasts = useToasts();
const friends = useRequest((signal) => app.api.listFriends(workspace.accountId.value, signal));
const drawerOpen = ref(false);
const editingFriend = ref<Friend | null>(null);
const submitting = ref(false);
const formError = ref('');

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
    toasts.notify('success', 'Friend configuration saved.');
  } catch (error) {
    formError.value =
      error instanceof ApiError ? error.message : 'Friend configuration could not be saved.';
    toasts.notify('error', 'Friend configuration could not be saved.');
  } finally {
    submitting.value = false;
  }
}

function matchFieldLabel(value: Friend['matchField']): string {
  const labels: Record<Friend['matchField'], string> = {
    secUid: 'Sec UID',
    uniqueId: 'Unique ID',
    shortId: 'Short ID',
    remarkName: 'Remark name',
    displayName: 'Display name',
  };
  return labels[value];
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
        <p class="eyebrow">Friends</p>
        <h3>Configured friends</h3>
        <p>Only enabled friends participate in runs.</p>
      </div>
      <button class="button button--primary" type="button" @click="beginCreate">Add friend</button>
    </header>

    <BackgroundRefreshIndicator v-if="friends.refreshing.value" />
    <StaleDataNotice
      v-if="friends.refreshError.value"
      :message="friends.refreshError.value.message"
      @retry="friends.load"
    />

    <SectionLoading
      v-if="friends.loading.value && friends.data.value === null"
      label="Loading friends…"
    />
    <section v-else-if="friends.initialError.value" class="section-error-stack">
      <InlineError :message="friends.initialError.value.message" />
      <button class="button button--secondary" type="button" @click="friends.load">Retry</button>
    </section>
    <EmptyState
      v-else-if="friends.data.value?.length === 0"
      title="No friends configured"
      description="Only enabled friends participate in runs."
    >
      <template #action>
        <button class="button button--primary" type="button" @click="beginCreate">
          Add friend
        </button>
      </template>
    </EmptyState>
    <div v-else-if="friends.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Display name</th>
            <th>Enabled</th>
            <th>Match strategy</th>
            <th>Identity configured</th>
            <th>Updated</th>
            <th>Actions</th>
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
                Low stability
              </small>
            </td>
            <td>{{ identityConfigured(friend) ? 'Configured' : 'Missing' }}</td>
            <td>{{ formatTimestamp(friend.updatedAt) }}</td>
            <td>
              <button
                class="button button--secondary button--compact"
                type="button"
                @click="beginEdit(friend)"
              >
                Edit
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Drawer
      :open="drawerOpen"
      :title="editingFriend === null ? 'Add friend' : 'Edit friend'"
      @close="closeDrawer"
    >
      <p class="drawer-intro">
        This stores local identity configuration only and does not contact the platform.
      </p>
      <FriendForm
        :friend="editingFriend ?? undefined"
        :submitting="submitting"
        :server-error="formError"
        @submit="saveFriend"
        @cancel="closeDrawer"
      />
    </Drawer>
  </div>
</template>
